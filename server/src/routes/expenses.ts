import { Router, Request, Response } from 'express';
import db from '../db/connection.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/expenses — list with filters
// ---------------------------------------------------------------------------

router.get('/', async (req: Request, res: Response) => {
  try {
    const { month, category_id, subcategory_id, account_id, status, statuses, date_from, date_to } = req.query;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const args: any[] = [];

    // Exclude split parents by default
    conditions.push(`e.review_status != 'split'`);

    // Filter by month (YYYY-MM)
    if (month && typeof month === 'string') {
      conditions.push(`strftime('%Y-%m', e.date) = ?`);
      args.push(month);
    }

    // Filter by date range
    if (date_from && typeof date_from === 'string') {
      conditions.push(`e.date >= ?`);
      args.push(date_from);
    }
    if (date_to && typeof date_to === 'string') {
      conditions.push(`e.date < ?`);
      args.push(date_to);
    }

    // Filter by category_id
    if (category_id) {
      const catId = parseInt(category_id as string, 10);
      if (!isNaN(catId)) {
        conditions.push(`e.category_id = ?`);
        args.push(catId);
      }
    }

    // Filter by subcategory_id
    if (subcategory_id) {
      const subId = parseInt(subcategory_id as string, 10);
      if (!isNaN(subId)) {
        conditions.push(`e.subcategory_id = ?`);
        args.push(subId);
      }
    }

    // Filter by account_id
    if (account_id) {
      const accId = parseInt(account_id as string, 10);
      if (!isNaN(accId)) {
        conditions.push(`e.account_id = ?`);
        args.push(accId);
      }
    }

    // Filter by single review status
    if (status && typeof status === 'string') {
      conditions.push(`e.review_status = ?`);
      args.push(status);
    }

    // Filter by multiple review statuses (comma-separated, e.g. "approved,skipped")
    if (statuses && typeof statuses === 'string') {
      const statusList = statuses.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (statusList.length > 0) {
        const placeholders = statusList.map(() => '?').join(', ');
        conditions.push(`e.review_status IN (${placeholders})`);
        args.push(...statusList);
      }
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Get total count for pagination
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM expenses e ${whereClause}`,
      args,
    });
    const total = Number((countResult.rows[0] as unknown as { total: number }).total);

    // Fetch paginated expenses with category names
    const expensesResult = await db.execute({
      sql: `SELECT e.*, c1.name as category_name, c2.name as subcategory_name
            FROM expenses e
            LEFT JOIN categories c1 ON e.category_id = c1.id
            LEFT JOIN categories c2 ON e.subcategory_id = c2.id
            ${whereClause}
            ORDER BY e.date DESC, e.id DESC
            LIMIT ? OFFSET ?`,
      args: [...args, limit, offset],
    });

    res.json({
      expenses: expensesResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('Error fetching expenses:', err);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/expenses/qc/count — count of categorization quality issues
// ---------------------------------------------------------------------------

const QC_CONDITION = `
  e.review_status IN ('approved', 'skipped')
  AND e.split_parent_id IS NULL
  AND (
    e.category_id IS NULL
    OR (e.subcategory_id IS NOT NULL AND e.subcategory_id NOT IN (
      SELECT id FROM categories WHERE parent_id = e.category_id
    ))
  )`;

router.get('/qc/count', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute({ sql: `SELECT COUNT(*) as count FROM expenses e WHERE ${QC_CONDITION}`, args: [] });
    res.json({ count: Number((result.rows[0] as unknown as { count: number }).count) });
  } catch (err) {
    console.error('Error fetching QC count:', err);
    res.status(500).json({ error: 'Failed to fetch QC count' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/expenses/qc — paginated list of categorization quality issues
// ---------------------------------------------------------------------------

router.get('/qc', async (req: Request, res: Response) => {
  try {
    const page  = parseInt(req.query.page  as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = (page - 1) * limit;

    const countResult = await db.execute({ sql: `SELECT COUNT(*) as total FROM expenses e WHERE ${QC_CONDITION}`, args: [] });
    const total = Number((countResult.rows[0] as unknown as { total: number }).total);

    const expensesResult = await db.execute({
      sql: `SELECT e.*,
                   c1.name as category_name,
                   c2.name as subcategory_name,
                   CASE WHEN e.category_id IS NULL THEN 'uncategorized' ELSE 'mismatch' END as issue_type
            FROM expenses e
            LEFT JOIN categories c1 ON e.category_id = c1.id
            LEFT JOIN categories c2 ON e.subcategory_id = c2.id
            WHERE ${QC_CONDITION}
            ORDER BY e.date DESC, e.id DESC
            LIMIT ? OFFSET ?`,
      args: [limit, offset],
    });

    res.json({ expenses: expensesResult.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Error fetching QC expenses:', err);
    res.status(500).json({ error: 'Failed to fetch QC expenses' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/expenses/:id — update editable fields (date, description, category)
// ---------------------------------------------------------------------------

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const { date, description, category_id, subcategory_id } = req.body;

    const fields: string[] = [];
    const args: any[] = [];

    if (date !== undefined) { fields.push('date = ?'); args.push(date); }
    if (description !== undefined) { fields.push('description = ?'); args.push(description); }
    if ('category_id' in req.body) { fields.push('category_id = ?'); args.push(category_id ?? null); }
    if ('subcategory_id' in req.body) { fields.push('subcategory_id = ?'); args.push(subcategory_id ?? null); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    fields.push("updated_at = datetime('now')");
    args.push(id);

    const result = await db.execute({
      sql: `UPDATE expenses SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
      args,
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating expense:', err);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/expenses/:id/category — update category assignment only
// ---------------------------------------------------------------------------

router.patch('/:id/category', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const { category_id, subcategory_id } = req.body;

    const result = await db.execute({
      sql: `UPDATE expenses
            SET category_id = ?, subcategory_id = ?, updated_at = datetime('now')
            WHERE id = ?
            RETURNING *`,
      args: [category_id ?? null, subcategory_id ?? null, id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating expense category:', err);
    res.status(500).json({ error: 'Failed to update expense category' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/expenses/:id — permanently delete an expense
// ---------------------------------------------------------------------------

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    // Delete dependent rows first (FK constraints are enforced by libsql)
    // 1. LLM suggestions referencing this expense
    await db.execute({ sql: `DELETE FROM llm_suggestions WHERE expense_id = ?`, args: [id] });
    // 2. LLM suggestions for any split children
    await db.execute({
      sql: `DELETE FROM llm_suggestions WHERE expense_id IN (SELECT id FROM expenses WHERE split_parent_id = ?)`,
      args: [id],
    });
    // 3. Split child expenses
    await db.execute({ sql: `DELETE FROM expenses WHERE split_parent_id = ?`, args: [id] });
    // 4. Unlink any matched Amazon orders (don't delete the order itself)
    await db.execute({
      sql: `UPDATE amazon_orders SET matched_expense_id = NULL WHERE matched_expense_id = ?`,
      args: [id],
    });
    // 5. Finally delete the expense itself
    await db.execute({ sql: `DELETE FROM expenses WHERE id = ?`, args: [id] });

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting expense:', err);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

export default router;
