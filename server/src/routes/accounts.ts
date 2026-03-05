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

// PATCH /api/accounts/:id — rename an account
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check for duplicate name (excluding this account)
    const existing = await db.execute({
      sql: 'SELECT id FROM accounts WHERE name = ? AND id != ?',
      args: [name.trim(), id],
    });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this name already exists' });
    }

    const result = await db.execute({
      sql: `UPDATE accounts SET name = ? WHERE id = ? RETURNING *`,
      args: [name.trim(), id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating account:', err);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

// DELETE /api/accounts/:id — delete an account (only if no transactions assigned)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    // Protect: refuse if any expenses reference this account
    const hasExpenses = await db.execute({
      sql: 'SELECT id FROM expenses WHERE account_id = ? LIMIT 1',
      args: [id],
    });
    if (hasExpenses.rows.length > 0) {
      return res.status(409).json({ error: 'Cannot delete an account that has transactions assigned to it' });
    }

    await db.execute({ sql: 'DELETE FROM accounts WHERE id = ?', args: [id] });
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting account:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
