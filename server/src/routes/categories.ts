import { Router, Request, Response } from 'express';
import db from '../db/connection.js';
import type { Category, CategoryWithChildren } from '../types/index.js';

const router = Router();

// GET /api/categories — return full category tree
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute('SELECT * FROM categories ORDER BY name');
    const categories = result.rows as unknown as Category[];

    // Build tree: top-level categories with children array
    const topLevel: CategoryWithChildren[] = [];
    const childMap = new Map<number, Category[]>();

    for (const cat of categories) {
      if (cat.parent_id === null) {
        topLevel.push({ ...cat, children: [] });
      } else {
        if (!childMap.has(cat.parent_id)) {
          childMap.set(cat.parent_id, []);
        }
        childMap.get(cat.parent_id)!.push(cat);
      }
    }

    for (const parent of topLevel) {
      parent.children = childMap.get(parent.id) || [];
    }

    res.json(topLevel);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/categories — create category or subcategory
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, parent_id } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (parent_id !== undefined && parent_id !== null) {
      // Verify parent exists and is a top-level category (max 2 levels)
      const parentResult = await db.execute({
        sql: 'SELECT * FROM categories WHERE id = ?',
        args: [parent_id],
      });

      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Parent category not found' });
      }

      const parent = parentResult.rows[0] as unknown as Category;
      if (parent.parent_id !== null) {
        return res.status(400).json({ error: 'Cannot nest more than 2 levels deep' });
      }
    }

    const result = await db.execute({
      sql: `INSERT INTO categories (name, parent_id, created_at) VALUES (?, ?, datetime('now')) RETURNING *`,
      args: [name.trim(), parent_id ?? null],
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating category:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PATCH /api/categories/:id — rename category
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await db.execute({
      sql: 'UPDATE categories SET name = ? WHERE id = ? RETURNING *',
      args: [name.trim(), id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating category:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/categories/:id — delete (blocked if expenses reference it)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if any expenses reference this category
    const expenseCount = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM expenses WHERE category_id = ? OR subcategory_id = ?',
      args: [id, id],
    });
    const count = Number((expenseCount.rows[0] as unknown as { count: number }).count);

    if (count > 0) {
      return res.status(409).json({ error: `Cannot delete category with ${count} assigned expenses` });
    }

    // Check if category has children
    const childCount = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM categories WHERE parent_id = ?',
      args: [id],
    });
    const children = Number((childCount.rows[0] as unknown as { count: number }).count);

    if (children > 0) {
      return res.status(409).json({ error: 'Cannot delete category with subcategories' });
    }

    const result = await db.execute({
      sql: 'DELETE FROM categories WHERE id = ?',
      args: [id],
    });

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted' });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
