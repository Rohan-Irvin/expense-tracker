import { Router, Request, Response } from 'express';
import db from '../db/connection.js';
import type { MonthlyTrendPoint, CategoryBreakdown, DashboardSummary } from '../types/index.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/dashboard/summary?from=YYYY-MM&to=YYYY-MM
// ---------------------------------------------------------------------------

router.get('/summary', async (req: Request, res: Response) => {
  try {
    // Default: trailing 12 months from current month
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const toMonth = (req.query.to as string) || currentMonth;
    const fromMonth = (req.query.from as string) || (() => {
      const d = new Date(toMonth + '-01');
      d.setMonth(d.getMonth() - 11);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    // Date range boundaries for SQL queries
    const dateFrom = `${fromMonth}-01`;
    // Compute the first day of the month after toMonth
    const toDate = new Date(toMonth + '-01');
    toDate.setMonth(toDate.getMonth() + 1);
    const dateTo = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-01`;

    // -----------------------------------------------------------------------
    // Monthly expenses
    // -----------------------------------------------------------------------
    const expensesByMonth = await db.execute({
      sql: `SELECT strftime('%Y-%m', date) as month, SUM(amount_aud) as total
            FROM expenses
            WHERE review_status IN ('approved', 'skipped') AND split_parent_id IS NULL
              AND date >= ? AND date < ?
            GROUP BY month`,
      args: [dateFrom, dateTo],
    });

    const expenseMap = new Map<string, number>();
    for (const row of expensesByMonth.rows) {
      const r = row as unknown as { month: string; total: number };
      expenseMap.set(r.month, r.total);
    }

    // -----------------------------------------------------------------------
    // Monthly income
    // -----------------------------------------------------------------------
    const incomeByMonth = await db.execute({
      sql: `SELECT strftime('%Y-%m', date) as month, SUM(amount_aud) as total
            FROM income_entries
            WHERE date >= ? AND date < ?
            GROUP BY month`,
      args: [dateFrom, dateTo],
    });

    const incomeMap = new Map<string, number>();
    for (const row of incomeByMonth.rows) {
      const r = row as unknown as { month: string; total: number };
      incomeMap.set(r.month, r.total);
    }

    // -----------------------------------------------------------------------
    // Build monthly trend array
    // -----------------------------------------------------------------------
    const monthlyTrend: MonthlyTrendPoint[] = [];
    const cursor = new Date(fromMonth + '-01');
    const endDate = new Date(dateTo);

    while (cursor < endDate) {
      const m = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      const totalExpenses = expenseMap.get(m) ?? 0;
      const totalIncome = incomeMap.get(m) ?? 0;

      monthlyTrend.push({
        month: m,
        total_expenses: Math.round(totalExpenses * 100) / 100,
        total_income: Math.round(totalIncome * 100) / 100,
        savings: Math.round((totalIncome - totalExpenses) * 100) / 100,
      });

      cursor.setMonth(cursor.getMonth() + 1);
    }

    // -----------------------------------------------------------------------
    // Category breakdown for the selected month (use toMonth)
    // -----------------------------------------------------------------------
    const categoryResult = await db.execute({
      sql: `SELECT e.category_id, c1.name as category_name,
                   e.subcategory_id, c2.name as subcategory_name,
                   SUM(e.amount_aud) as total_aud
            FROM expenses e
            LEFT JOIN categories c1 ON e.category_id = c1.id
            LEFT JOIN categories c2 ON e.subcategory_id = c2.id
            WHERE e.review_status IN ('approved', 'skipped') AND e.split_parent_id IS NULL
              AND strftime('%Y-%m', e.date) = ?
            GROUP BY e.category_id, e.subcategory_id
            ORDER BY total_aud DESC`,
      args: [toMonth],
    });

    // Get the selected month's income total for percentage calculation
    const selectedMonthIncome = incomeMap.get(toMonth) ?? 0;
    const selectedMonthExpenses = expenseMap.get(toMonth) ?? 0;

    const categoryBreakdown: CategoryBreakdown[] = categoryResult.rows.map((row) => {
      const r = row as unknown as {
        category_id: number;
        category_name: string;
        subcategory_id: number | null;
        subcategory_name: string | null;
        total_aud: number;
      };

      return {
        category_id: r.category_id,
        category_name: r.category_name ?? 'Uncategorized',
        subcategory_id: r.subcategory_id,
        subcategory_name: r.subcategory_name,
        total_aud: Math.round(r.total_aud * 100) / 100,
        percentage_of_income: selectedMonthIncome > 0
          ? Math.round((r.total_aud / selectedMonthIncome) * 10000) / 100
          : 0,
      };
    });

    // -----------------------------------------------------------------------
    // Assemble response
    // -----------------------------------------------------------------------
    const summary: DashboardSummary = {
      monthly_trend: monthlyTrend,
      category_breakdown: categoryBreakdown,
      selected_month_total_expenses: Math.round(selectedMonthExpenses * 100) / 100,
      selected_month_total_income: Math.round(selectedMonthIncome * 100) / 100,
      selected_month_savings: Math.round((selectedMonthIncome - selectedMonthExpenses) * 100) / 100,
    };

    res.json(summary);
  } catch (err) {
    console.error('Error fetching dashboard summary:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

export default router;
