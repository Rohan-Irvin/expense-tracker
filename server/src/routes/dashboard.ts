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
            WHERE review_status IN ('approved', 'skipped')
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
    // Category breakdown for the FULL selected date range
    // -----------------------------------------------------------------------
    const categoryResult = await db.execute({
      sql: `SELECT e.category_id, c1.name as category_name,
                   e.subcategory_id, c2.name as subcategory_name,
                   SUM(e.amount_aud) as total_aud
            FROM expenses e
            LEFT JOIN categories c1 ON e.category_id = c1.id
            LEFT JOIN categories c2 ON e.subcategory_id = c2.id
            WHERE e.review_status IN ('approved', 'skipped')
              AND e.date >= ? AND e.date < ?
            GROUP BY e.category_id, e.subcategory_id
            ORDER BY total_aud DESC`,
      args: [dateFrom, dateTo],
    });

    // -----------------------------------------------------------------------
    // Period totals — sum all months in the trend array
    // -----------------------------------------------------------------------
    const periodTotalIncome = monthlyTrend.reduce((sum, m) => sum + m.total_income, 0);
    const periodTotalExpenses = monthlyTrend.reduce((sum, m) => sum + m.total_expenses, 0);
    const periodSavings = periodTotalIncome - periodTotalExpenses;

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
        percentage_of_income: periodTotalIncome > 0
          ? Math.round((r.total_aud / periodTotalIncome) * 10000) / 100
          : 0,
      };
    });

    // -----------------------------------------------------------------------
    // Assemble response — reuse existing field names for type compatibility
    // -----------------------------------------------------------------------
    const summary: DashboardSummary = {
      monthly_trend: monthlyTrend,
      category_breakdown: categoryBreakdown,
      selected_month_total_expenses: Math.round(periodTotalExpenses * 100) / 100,
      selected_month_total_income: Math.round(periodTotalIncome * 100) / 100,
      selected_month_savings: Math.round(periodSavings * 100) / 100,
    };

    res.json(summary);
  } catch (err) {
    console.error('Error fetching dashboard summary:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/trends?from=YYYY-MM&to=YYYY-MM&items=cat:1,cat:2,sub:3
// items: comma-separated list of "cat:ID" (category) and "sub:ID" (subcategory) keys
// Returns monthly totals per selected item as series
// ---------------------------------------------------------------------------

router.get('/trends', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const toMonth = (req.query.to as string) || currentMonth;
    const fromMonth = (req.query.from as string) || (() => {
      const d = new Date(toMonth + '-01');
      d.setMonth(d.getMonth() - 11);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();

    // Parse items=cat:1,sub:3,cat:2 into separate id arrays
    const itemsParam = (req.query.items as string) || '';
    const parsedItems = itemsParam
      .split(',')
      .map((s) => {
        const [type, idStr] = s.trim().split(':');
        const id = parseInt(idStr, 10);
        return (type === 'cat' || type === 'sub') && !isNaN(id) ? { type: type as 'cat' | 'sub', id } : null;
      })
      .filter(Boolean) as { type: 'cat' | 'sub'; id: number }[];

    const catIds = parsedItems.filter((i) => i.type === 'cat').map((i) => i.id);
    const subIds = parsedItems.filter((i) => i.type === 'sub').map((i) => i.id);

    if (catIds.length === 0 && subIds.length === 0) {
      return res.json({ months: [], series: [], data: [] });
    }

    const dateFrom = `${fromMonth}-01`;
    const toDate = new Date(toMonth + '-01');
    toDate.setMonth(toDate.getMonth() + 1);
    const dateTo = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-01`;

    // Build complete months array (fill gaps so chart has every month)
    const months: string[] = [];
    const cursor = new Date(fromMonth + '-01');
    const endDate = new Date(dateTo);
    while (cursor < endDate) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    interface DataRow { month: string; series_key: string; total_aud: number; }
    const allRows: DataRow[] = [];

    // Query 1: category-level items (filter by category_id, regardless of subcategory)
    if (catIds.length > 0) {
      const catResult = await db.execute({
        sql: `SELECT strftime('%Y-%m', e.date) as month,
                     'cat:' || e.category_id as series_key,
                     SUM(e.amount_aud) as total_aud
              FROM expenses e
              WHERE e.review_status IN ('approved', 'skipped')
                  AND e.date >= ? AND e.date < ?
                AND e.category_id IN (${catIds.map(() => '?').join(',')})
              GROUP BY month, e.category_id
              ORDER BY month`,
        args: [dateFrom, dateTo, ...catIds],
      });
      for (const row of catResult.rows as unknown as DataRow[]) {
        allRows.push({ month: row.month, series_key: row.series_key, total_aud: Math.round(row.total_aud * 100) / 100 });
      }
    }

    // Query 1b: expenses in selected categories whose subcategory is null OR doesn't belong
    // to that category (catches both truly uncategorized and category/subcategory mismatches)
    if (catIds.length > 0) {
      const uncatResult = await db.execute({
        sql: `SELECT strftime('%Y-%m', e.date) as month,
                     'uncat:' || e.category_id as series_key,
                     SUM(e.amount_aud) as total_aud
              FROM expenses e
              WHERE e.review_status IN ('approved', 'skipped')
                  AND e.date >= ? AND e.date < ?
                AND e.category_id IN (${catIds.map(() => '?').join(',')})
                AND (e.subcategory_id IS NULL
                     OR e.subcategory_id NOT IN (
                       SELECT id FROM categories WHERE parent_id = e.category_id
                     ))
              GROUP BY month, e.category_id
              ORDER BY month`,
        args: [dateFrom, dateTo, ...catIds],
      });
      for (const row of uncatResult.rows as unknown as DataRow[]) {
        allRows.push({ month: row.month, series_key: row.series_key, total_aud: Math.round(row.total_aud * 100) / 100 });
      }
    }

    // Query 2: subcategory-level items (filter by subcategory_id specifically)
    if (subIds.length > 0) {
      const subResult = await db.execute({
        sql: `SELECT strftime('%Y-%m', e.date) as month,
                     'sub:' || e.subcategory_id as series_key,
                     SUM(e.amount_aud) as total_aud
              FROM expenses e
              WHERE e.review_status IN ('approved', 'skipped')
                  AND e.date >= ? AND e.date < ?
                AND e.subcategory_id IN (${subIds.map(() => '?').join(',')})
              GROUP BY month, e.subcategory_id
              ORDER BY month`,
        args: [dateFrom, dateTo, ...subIds],
      });
      for (const row of subResult.rows as unknown as DataRow[]) {
        allRows.push({ month: row.month, series_key: row.series_key, total_aud: Math.round(row.total_aud * 100) / 100 });
      }
    }

    // Build series metadata (name lookups) preserving the user's selection order
    const seriesMap = new Map<string, { key: string; name: string; type: 'category' | 'subcategory' | 'uncategorized' }>();
    if (catIds.length > 0) {
      const catNames = await db.execute({
        sql: `SELECT id, name FROM categories WHERE id IN (${catIds.map(() => '?').join(',')})`,
        args: catIds,
      });
      for (const row of catNames.rows as unknown as { id: number; name: string }[]) {
        seriesMap.set(`cat:${row.id}`, { key: `cat:${row.id}`, name: row.name, type: 'category' });
        seriesMap.set(`uncat:${row.id}`, { key: `uncat:${row.id}`, name: `${row.name} › Uncategorized`, type: 'uncategorized' });
      }
    }
    if (subIds.length > 0) {
      const subNames = await db.execute({
        sql: `SELECT c.id, c.name, p.name as parent_name
              FROM categories c
              LEFT JOIN categories p ON c.parent_id = p.id
              WHERE c.id IN (${subIds.map(() => '?').join(',')})`,
        args: subIds,
      });
      for (const row of subNames.rows as unknown as { id: number; name: string; parent_name: string | null }[]) {
        const displayName = row.parent_name ? `${row.parent_name} › ${row.name}` : row.name;
        seriesMap.set(`sub:${row.id}`, { key: `sub:${row.id}`, name: displayName, type: 'subcategory' });
      }
    }

    // Return series in the user's selection order; inject uncat rows after each cat (only if data exists)
    const seriesKeysWithData = new Set(allRows.map((r) => r.series_key));
    const series: { key: string; name: string; type: string }[] = [];
    for (const item of parsedItems) {
      const s = seriesMap.get(`${item.type}:${item.id}`);
      if (s) series.push(s);
      if (item.type === 'cat') {
        const uncatKey = `uncat:${item.id}`;
        const uncat = seriesMap.get(uncatKey);
        if (uncat && seriesKeysWithData.has(uncatKey)) series.push(uncat);
      }
    }

    res.json({ months, series, data: allRows });
  } catch (err) {
    console.error('Error fetching trends data:', err);
    res.status(500).json({ error: 'Failed to fetch trends data' });
  }
});

export default router;
