import { Router, Request, Response } from 'express';
import db from '../db/connection.js';

const router = Router();

// GET /api/income-categories
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute({
      sql: `SELECT * FROM income_categories ORDER BY name ASC`,
      args: [],
    });
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching income categories:', err);
    res.status(500).json({ error: 'Failed to fetch income categories' });
  }
});

// POST /api/income-categories
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const result = await db.execute({
      sql: `INSERT INTO income_categories (name, created_at) VALUES (?, datetime('now')) RETURNING *`,
      args: [name.trim()],
    });
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A category with that name already exists' });
    }
    console.error('Error creating income category:', err);
    res.status(500).json({ error: 'Failed to create income category' });
  }
});

// PATCH /api/income-categories/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

    const result = await db.execute({
      sql: `UPDATE income_categories SET name = ? WHERE id = ? RETURNING *`,
      args: [name.trim(), id],
    });
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A category with that name already exists' });
    }
    console.error('Error renaming income category:', err);
    res.status(500).json({ error: 'Failed to rename income category' });
  }
});

// DELETE /api/income-categories/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    // Null-out references before deleting
    await db.execute({
      sql: `UPDATE income_entries SET income_category_id = NULL WHERE income_category_id = ?`,
      args: [id],
    });
    await db.execute({ sql: `DELETE FROM income_categories WHERE id = ?`, args: [id] });
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting income category:', err);
    res.status(500).json({ error: 'Failed to delete income category' });
  }
});

export default router;
