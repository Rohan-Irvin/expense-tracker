import { Router, Request, Response } from 'express';
import db from '../db/connection.js';

const router = Router();

// GET /api/accounts — list all accounts
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute('SELECT * FROM accounts ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching accounts:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// POST /api/accounts — create account
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, currency } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (currency !== 'AUD' && currency !== 'USD') {
      return res.status(400).json({ error: 'Currency must be AUD or USD' });
    }

    // Check if name already exists
    const existing = await db.execute({
      sql: 'SELECT id FROM accounts WHERE name = ?',
      args: [name.trim()],
    });

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this name already exists' });
    }

    const result = await db.execute({
      sql: `INSERT INTO accounts (name, currency, created_at) VALUES (?, ?, datetime('now')) RETURNING *`,
      args: [name.trim(), currency],
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating account:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

export default router;
