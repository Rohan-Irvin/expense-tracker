import { Router, Request, Response } from 'express';
import multer from 'multer';
import db from '../db/connection.js';
import { parseCsvFile, applyColumnMap } from '../services/csvParser.js';
import { getExchangeRate } from '../services/exchangeRate.js';
import { categorizeBatchExpenses, updateMerchantRules } from '../services/categorizer.js';
import type { ColumnMap, Expense, SplitRow } from '../types/index.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// POST /api/import/parse — upload CSV, return columns + samples
// ---------------------------------------------------------------------------

router.post('/import/parse', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const accountId = parseInt(req.body.accountId, 10);
    if (isNaN(accountId)) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    const result = await parseCsvFile(req.file.buffer, accountId);
    res.json(result);
  } catch (err) {
    console.error('Error parsing CSV:', err);
    res.status(500).json({ error: 'Failed to parse CSV file' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/import/confirm — confirm mapping, create batch + expenses
// ---------------------------------------------------------------------------

router.post('/import/confirm', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const accountId = parseInt(req.body.accountId, 10);
    const filename = req.body.filename as string;
    const columnMap: ColumnMap = JSON.parse(req.body.columnMap);

    if (isNaN(accountId) || !filename || !columnMap) {
      return res.status(400).json({ error: 'accountId, filename, and columnMap are required' });
    }

    // Look up the account currency
    const accountResult = await db.execute({
      sql: 'SELECT currency FROM accounts WHERE id = ?',
      args: [accountId],
    });

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const currency = (accountResult.rows[0] as unknown as { currency: 'AUD' | 'USD' }).currency;

    // Parse all rows using the confirmed column map
    const rows = applyColumnMap(req.file.buffer, columnMap);

    // Create the import batch
    const batchResult = await db.execute({
      sql: `INSERT INTO import_batches (account_id, filename, imported_at, row_count, status, column_map)
            VALUES (?, ?, datetime('now'), ?, 'pending_review', ?)
            RETURNING *`,
      args: [accountId, filename, rows.length, JSON.stringify(columnMap)],
    });

    const batchId = (batchResult.rows[0] as unknown as { id: number }).id;

    // Insert all expense rows
    for (const row of rows) {
      let amountAud: number;
      let exchangeRate: number | null = null;

      if (currency === 'USD') {
        const rate = await getExchangeRate(row.date, 'USD', 'AUD');
        amountAud = Math.round(row.amount * rate * 100) / 100;
        exchangeRate = rate;
      } else {
        amountAud = row.amount;
      }

      await db.execute({
        sql: `INSERT INTO expenses (batch_id, account_id, date, description, amount_original, currency_original, exchange_rate, amount_aud, review_status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
        args: [batchId, accountId, row.date, row.description, row.amount, currency, exchangeRate, amountAud],
      });
    }

    res.json({ batchId, rowCount: rows.length });
  } catch (err) {
    console.error('Error confirming import:', err);
    res.status(500).json({ error: 'Failed to confirm import' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/import/:batchId/categorize — trigger LLM (SSE stream)
// ---------------------------------------------------------------------------

router.post('/import/:batchId/categorize', async (req: Request, res: Response) => {
  let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

  try {
    const batchId = parseInt(req.params.batchId as string, 10);
    if (isNaN(batchId)) {
      return res.status(400).json({ error: 'Invalid batchId' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Disable socket timeout — LLM batches can take several minutes each
    req.socket?.setTimeout(0);

    // Send SSE keepalive comment every 15s so the Vite proxy / browser
    // never considers the connection idle and closes it.
    keepaliveInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    await categorizeBatchExpenses(batchId, (done, total) => {
      res.write(`data: ${JSON.stringify({ done, total })}\n\n`);
    });

    // Send completion event
    // Get the total from the batch to send accurate final message
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM expenses WHERE batch_id = ? AND split_parent_id IS NULL`,
      args: [batchId],
    });
    const total = Number((countResult.rows[0] as unknown as { total: number }).total);

    res.write(`data: ${JSON.stringify({ done: total, total, complete: true })}\n\n`);
    res.end();
  } catch (err: any) {
    console.error('Error during categorization:', err);
    const isConnRefused = err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED';
    const message = isConnRefused
      ? 'Cannot connect to LM Studio. Make sure LM Studio is running with the local server enabled (port 1234).'
      : (err?.message || 'Categorization failed');
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: message });
    }
  } finally {
    if (keepaliveInterval) clearInterval(keepaliveInterval);
  }
});

// ---------------------------------------------------------------------------
// GET /api/import/:batchId/review — fetch expenses + suggestions
// ---------------------------------------------------------------------------

router.get('/import/:batchId/review', async (req: Request, res: Response) => {
  try {
    const batchId = parseInt(req.params.batchId as string, 10);
    if (isNaN(batchId)) {
      return res.status(400).json({ error: 'Invalid batchId' });
    }

    // Fetch batch info
    const batchResult = await db.execute({
      sql: 'SELECT * FROM import_batches WHERE id = ?',
      args: [batchId],
    });

    if (batchResult.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const batch = batchResult.rows[0];

    // Fetch expenses with suggestions and category names
    const expensesResult = await db.execute({
      sql: `SELECT e.*,
              ls.suggested_category_id, ls.suggested_subcategory_id, ls.confidence, ls.llm_reasoning,
              c1.name as category_name, c2.name as subcategory_name,
              c3.name as suggested_category_name, c4.name as suggested_subcategory_name
            FROM expenses e
            LEFT JOIN llm_suggestions ls ON ls.expense_id = e.id
            LEFT JOIN categories c1 ON e.category_id = c1.id
            LEFT JOIN categories c2 ON e.subcategory_id = c2.id
            LEFT JOIN categories c3 ON ls.suggested_category_id = c3.id
            LEFT JOIN categories c4 ON ls.suggested_subcategory_id = c4.id
            WHERE e.batch_id = ? AND e.split_parent_id IS NULL
            ORDER BY e.date ASC`,
      args: [batchId],
    });

    const expenses = expensesResult.rows as unknown as (Expense & {
      suggested_category_id: number | null;
      suggested_subcategory_id: number | null;
      confidence: string | null;
      llm_reasoning: string | null;
      category_name: string | null;
      subcategory_name: string | null;
      suggested_category_name: string | null;
      suggested_subcategory_name: string | null;
      children?: Expense[];
    })[];

    // Fetch split children for expenses with review_status = 'split'
    for (const expense of expenses) {
      if (expense.review_status === 'split') {
        const childrenResult = await db.execute({
          sql: `SELECT e.*,
                  c1.name as category_name, c2.name as subcategory_name
                FROM expenses e
                LEFT JOIN categories c1 ON e.category_id = c1.id
                LEFT JOIN categories c2 ON e.subcategory_id = c2.id
                WHERE e.split_parent_id = ?
                ORDER BY e.id ASC`,
          args: [expense.id],
        });
        expense.children = childrenResult.rows as unknown as Expense[];
      }
    }

    res.json({ batch, expenses });
  } catch (err) {
    console.error('Error fetching review data:', err);
    res.status(500).json({ error: 'Failed to fetch review data' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/expenses/:id/approve — approve with category
// ---------------------------------------------------------------------------

router.patch('/expenses/:id/approve', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }

    const { category_id, subcategory_id } = req.body;
    if (!category_id) {
      return res.status(400).json({ error: 'category_id is required' });
    }

    const result = await db.execute({
      sql: `UPDATE expenses SET category_id = ?, subcategory_id = ?, review_status = 'approved', updated_at = datetime('now')
            WHERE id = ? RETURNING *`,
      args: [category_id, subcategory_id ?? null, id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error approving expense:', err);
    res.status(500).json({ error: 'Failed to approve expense' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/expenses/:id/skip — skip expense
// ---------------------------------------------------------------------------

router.patch('/expenses/:id/skip', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }

    const result = await db.execute({
      sql: `UPDATE expenses SET review_status = 'skipped', updated_at = datetime('now')
            WHERE id = ? RETURNING *`,
      args: [id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error skipping expense:', err);
    res.status(500).json({ error: 'Failed to skip expense' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/expenses/:id/split — split into sub-rows
// ---------------------------------------------------------------------------

router.post('/expenses/:id/split', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }

    const splits: SplitRow[] = req.body;
    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ error: 'Array of split rows is required' });
    }

    // Fetch the parent expense
    const parentResult = await db.execute({
      sql: 'SELECT * FROM expenses WHERE id = ?',
      args: [id],
    });

    if (parentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    const parent = parentResult.rows[0] as unknown as Expense;

    // Validate: sum of amounts must equal parent's amount_aud (within 0.01 tolerance)
    const splitSum = splits.reduce((sum, s) => sum + s.amount_aud, 0);
    if (Math.abs(splitSum - parent.amount_aud) > 0.01) {
      return res.status(400).json({
        error: `Split amounts sum to ${splitSum.toFixed(2)} but parent amount is ${parent.amount_aud.toFixed(2)}`,
      });
    }

    // Set parent review_status = 'split'
    await db.execute({
      sql: `UPDATE expenses SET review_status = 'split', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    });

    // Insert child expenses
    const children: any[] = [];
    for (const split of splits) {
      // Proportional original amount
      const proportion = split.amount_aud / parent.amount_aud;
      const amountOriginal = Math.round(parent.amount_original * proportion * 100) / 100;

      const childResult = await db.execute({
        sql: `INSERT INTO expenses (batch_id, account_id, date, description, amount_original, currency_original, exchange_rate, amount_aud, category_id, subcategory_id, split_parent_id, review_status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', datetime('now'), datetime('now'))
              RETURNING *`,
        args: [
          parent.batch_id,
          parent.account_id,
          parent.date,
          split.description,
          amountOriginal,
          parent.currency_original,
          parent.exchange_rate,
          split.amount_aud,
          split.category_id,
          split.subcategory_id,
          id,
        ],
      });

      children.push(childResult.rows[0]);
    }

    res.json(children);
  } catch (err) {
    console.error('Error splitting expense:', err);
    res.status(500).json({ error: 'Failed to split expense' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/expenses/:id/unsplit — undo split
// ---------------------------------------------------------------------------

router.delete('/expenses/:id/unsplit', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }

    // Delete all child expenses
    await db.execute({
      sql: 'DELETE FROM expenses WHERE split_parent_id = ?',
      args: [id],
    });

    // Reset parent to pending
    await db.execute({
      sql: `UPDATE expenses SET review_status = 'pending', updated_at = datetime('now') WHERE id = ?`,
      args: [id],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error unsplitting expense:', err);
    res.status(500).json({ error: 'Failed to unsplit expense' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/import/:batchId/finalize — finalize batch
// ---------------------------------------------------------------------------

router.post('/import/:batchId/finalize', async (req: Request, res: Response) => {
  try {
    const batchId = parseInt(req.params.batchId as string, 10);
    if (isNaN(batchId)) {
      return res.status(400).json({ error: 'Invalid batchId' });
    }

    // Update batch status to approved
    await db.execute({
      sql: `UPDATE import_batches SET status = 'approved' WHERE id = ?`,
      args: [batchId],
    });

    // Update merchant rules from approved expenses
    await updateMerchantRules(batchId);

    res.json({ ok: true });
  } catch (err) {
    console.error('Error finalizing batch:', err);
    res.status(500).json({ error: 'Failed to finalize batch' });
  }
});

export default router;
