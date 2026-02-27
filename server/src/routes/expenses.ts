import { Router, Request, Response } from 'express';
import db from '../db/connection.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/expenses — list with filters
// ---------------------------------------------------------------------------

router.get('/', async (req: Request, res: Response) => {
  try {
    const { month, category_id, account_id, status } = req.query;
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

    // Filter by category_id
    if (category_id) {
      const catId = parseInt(category_id as string, 10);
      if (!isNaN(catId)) {
        conditions.push(`e.category_id = ?`);
        args.push(catId);
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

    // Filter by review status
    if (status && typeof status === 'string') {
      conditions.push(`e.review_status = ?`);
      args.push(status);
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

export default router;
