const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta principal para Render
app.get('/', (req, res) => {
    res.send('Backend funcionando 🚀');
});

// Conexión MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ======================
// AUTH ROUTES
// ======================

// Registro
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [result] = await pool.execute(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, password]
        );

        res.json({
            id: result.insertId,
            username
        });

    } catch (err) {
        res.status(400).json({
            error: 'El usuario ya existe o datos inválidos'
        });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [rows] = await pool.execute(
            'SELECT id, username FROM users WHERE username = ? AND password = ?',
            [username, password]
        );

        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

    } catch (err) {
        res.status(500).json({
            error: 'Error del servidor'
        });
    }
});

// ======================
// DEBT ROUTES
// ======================

// Obtener deudas
app.get('/api/debts/:userId', async (req, res) => {
    try {

        const [rows] = await pool.execute(
            'SELECT * FROM debts WHERE user_id = ? ORDER BY created_at DESC',
            [req.params.userId]
        );

        const debtsWithTransactions = await Promise.all(

            rows.map(async (debt) => {

                const [payments] = await pool.execute(
                    'SELECT * FROM transactions WHERE debt_id = ? AND type = "payment"',
                    [debt.id]
                );

                const [increases] = await pool.execute(
                    'SELECT * FROM transactions WHERE debt_id = ? AND type = "increase"',
                    [debt.id]
                );

                return {
                    ...debt,
                    payments,
                    increases
                };

            })

        );

        res.json(debtsWithTransactions);

    } catch (err) {

        res.status(500).json({
            error: err.message
        });

    }
});

// Crear deuda
app.post('/api/debts', async (req, res) => {

    const {
        userId,
        description,
        amount,
        category
    } = req.body;

    try {

        const [result] = await pool.execute(
            `
            INSERT INTO debts
            (user_id, description, total_amount, current_balance, category)
            VALUES (?, ?, ?, ?, ?)
            `,
            [userId, description, amount, amount, category]
        );

        res.json({
            id: result.insertId
        });

    } catch (err) {

        res.status(500).json({
            error: err.message
        });

    }
});

// Registrar transacciones
app.post('/api/transactions', async (req, res) => {

    const {
        debtId,
        type,
        amount
    } = req.body;

    try {

        const connection = await pool.getConnection();

        await connection.beginTransaction();

        try {

            // Guardar transacción
            await connection.execute(
                `
                INSERT INTO transactions
                (debt_id, type, amount)
                VALUES (?, ?, ?)
                `,
                [debtId, type, amount]
            );

            // Restar saldo
            if (type === 'payment') {

                await connection.execute(
                    `
                    UPDATE debts
                    SET current_balance = current_balance - ?
                    WHERE id = ?
                    `,
                    [amount, debtId]
                );

            } else {

                // Aumentar deuda
                await connection.execute(
                    `
                    UPDATE debts
                    SET total_amount = total_amount + ?,
                        current_balance = current_balance + ?
                    WHERE id = ?
                    `,
                    [amount, amount, debtId]
                );

            }

            await connection.commit();

            res.json({
                success: true
            });

        } catch (err) {

            await connection.rollback();

            throw err;

        } finally {

            connection.release();

        }

    } catch (err) {

        res.status(500).json({
            error: err.message
        });

    }
});

// Eliminar deuda
app.delete('/api/debts/:id', async (req, res) => {

    try {

        await pool.execute(
            'DELETE FROM debts WHERE id = ?',
            [req.params.id]
        );

        res.json({
            success: true
        });

    } catch (err) {

        res.status(500).json({
            error: err.message
        });

    }

});

// ======================
// SERVER
// ======================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});