import { Router, Request, Response } from 'express';
import db from '../db/connection.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/merchant-rules — list rules with category names
// ---------------------------------------------------------------------------

router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute({
      sql: `SELECT mr.*, c1.name as category_name, c2.name as subcategory_name
            FROM merchant_rules mr
            LEFT JOIN categories c1 ON mr.category_id = c1.id
            LEFT JOIN categories c2 ON mr.subcategory_id = c2.id
            ORDER BY mr.match_count DESC`,
      args: [],
    });

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching merchant rules:', err);
    res.status(500).json({ error: 'Failed to fetch merchant rules' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/merchant-rules/:id — update category
// ---------------------------------------------------------------------------

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid rule id' });
    }

    const { category_id, subcategory_id } = req.body;

    if (!category_id) {
      return res.status(400).json({ error: 'category_id is required' });
    }

    const result = await db.execute({
      sql: `UPDATE merchant_rules SET category_id = ?, subcategory_id = ? WHERE id = ? RETURNING *`,
      args: [category_id, subcategory_id ?? null, id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Merchant rule not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating merchant rule:', err);
    res.status(500).json({ error: 'Failed to update merchant rule' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/merchant-rules/:id — delete rule
// ---------------------------------------------------------------------------

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid rule id' });
    }

    const result = await db.execute({
      sql: `DELETE FROM merchant_rules WHERE id = ?`,
      args: [id],
    });

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Merchant rule not found' });
    }

    res.json({ message: 'Merchant rule deleted' });
  } catch (err) {
    console.error('Error deleting merchant rule:', err);
    res.status(500).json({ error: 'Failed to delete merchant rule' });
  }
});

export default router;
