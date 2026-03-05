import { Router, Request, Response } from 'express';
import multer from 'multer';
import db from '../db/connection.js';
import { parseCsvFile } from '../services/csvParser.js';
import { getExchangeRate } from '../services/exchangeRate.js';

// ---------------------------------------------------------------------------
// Date normalisation — converts DD/MM/YYYY (DMY), MM/DD/YYYY (MDY), or
// YYYY-MM-DD (ISO) into a stored ISO string. Returns the raw value unchanged
// if it cannot be parsed, so the row-level validation will discard it.
// ---------------------------------------------------------------------------

function normalizeDate(raw: string, fmt: string): string {
  const s = raw.trim();
  if (!s) return s;

  // Already YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) {
    return s.replace(/\//g, '-');
  }

  // Expect DD/MM/YYYY, MM/DD/YYYY (slash or dash separator)
  const parts = s.split(/[-/]/);
  if (parts.length !== 3) return s;

  let d: string, m: string, y: string;
  if (fmt === 'MDY') {
    [m, d, y] = parts;
  } else {
    // DMY — Australian default
    [d, m, y] = parts;
  }

  if (y.length === 2) y = `20${y}`;
  if (y.length !== 4) return s;

  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// GET /api/income — list all income entries
// ---------------------------------------------------------------------------

router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute({
      sql: `SELECT ie.*, c.name as category_name
            FROM income_entries ie
            LEFT JOIN categories c ON ie.category_id = c.id
            ORDER BY ie.date DESC`,
      args: [],
    });

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching income entries:', err);
    res.status(500).json({ error: 'Failed to fetch income entries' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/income — manual entry
// ---------------------------------------------------------------------------

router.post('/', async (req: Request, res: Response) => {
  try {
    const { date, source, amount_original, currency_original, note, category_id } = req.body;

    if (!date || !source || amount_original === undefined || !currency_original) {
      return res.status(400).json({ error: 'date, source, amount_original, and currency_original are required' });
    }

    let amountAud: number;
    let exchangeRate: number | null = null;

    if (currency_original === 'USD') {
      const rate = await getExchangeRate(date, 'USD', 'AUD');
      amountAud = Math.round(amount_original * rate * 100) / 100;
      exchangeRate = rate;
    } else {
      amountAud = amount_original;
    }

    const result = await db.execute({
      sql: `INSERT INTO income_entries (date, source, amount_original, currency_original, exchange_rate, amount_aud, entry_type, note, category_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, datetime('now'))
            RETURNING *`,
      args: [date, source, amount_original, currency_original, exchangeRate, amountAud, note ?? null, category_id ?? null],
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating income entry:', err);
    res.status(500).json({ error: 'Failed to create income entry' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/income/parse — upload income CSV, return columns + samples
// ---------------------------------------------------------------------------

router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Use accountId 0 as a placeholder — parseCsvFile uses it only for
    // looking up previous column maps on the same account, which doesn't
    // apply to income imports.
    const accountId = parseInt(req.body.accountId, 10) || 0;
    const result = await parseCsvFile(req.file.buffer, accountId);
    res.json(result);
  } catch (err) {
    console.error('Error parsing income CSV:', err);
    res.status(500).json({ error: 'Failed to parse income CSV' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/income/confirm — confirm mapping, create entries
// ---------------------------------------------------------------------------

router.post('/confirm', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const columnMap = JSON.parse(req.body.columnMap);
    const currency: string = req.body.currency || 'AUD';
    const dateFormat: string = req.body.dateFormat || 'DMY'; // DMY | MDY | ISO

    if (!columnMap) {
      return res.status(400).json({ error: 'columnMap is required' });
    }

    // Parse the CSV using csv-parse
    const { parse } = await import('csv-parse/sync');
    const csvString = req.file.buffer.toString('utf-8');

    let rows: Record<string, string>[];

    if (columnMap.hasHeader) {
      rows = parse(csvString, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
      });
    } else {
      const raw: string[][] = parse(csvString, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
      });

      const colCount = raw.length > 0 ? raw[0].length : 0;
      const colNames = Array.from({ length: colCount }, (_, i) => `col_${i}`);

      rows = raw.map((row: string[]) => {
        const obj: Record<string, string> = {};
        for (let i = 0; i < colCount; i++) {
          obj[colNames[i]] = row[i] ?? '';
        }
        return obj;
      });
    }

    let count = 0;

    for (const row of rows) {
      const date = normalizeDate((row[columnMap.date] ?? '').trim(), dateFormat);
      const source = (row[columnMap.source] ?? '').trim();
      const amountStr = (row[columnMap.amount] ?? '').replace(/[^0-9.\-]/g, '').trim();
      const amountOriginal = parseFloat(amountStr);

      if (!date || !source || isNaN(amountOriginal)) continue;

      let amountAud: number;
      let exchangeRate: number | null = null;

      if (currency === 'USD') {
        const rate = await getExchangeRate(date, 'USD', 'AUD');
        amountAud = Math.round(amountOriginal * rate * 100) / 100;
        exchangeRate = rate;
      } else {
        amountAud = amountOriginal;
      }

      await db.execute({
        sql: `INSERT INTO income_entries (date, source, amount_original, currency_original, exchange_rate, amount_aud, entry_type, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'csv_import', datetime('now'))`,
        args: [date, source, amountOriginal, currency, exchangeRate, amountAud],
      });

      count++;
    }

    res.json({ count });
  } catch (err) {
    console.error('Error confirming income import:', err);
    res.status(500).json({ error: 'Failed to confirm income import' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/income/:id — update an income entry
// ---------------------------------------------------------------------------

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const { date, source, amount_original, currency_original, note, category_id } = req.body;

    if (!date || !source || amount_original === undefined || !currency_original) {
      return res.status(400).json({ error: 'date, source, amount_original, and currency_original are required' });
    }

    let amountAud: number;
    let exchangeRate: number | null = null;

    if (currency_original === 'USD') {
      const rate = await getExchangeRate(date, 'USD', 'AUD');
      amountAud = Math.round(amount_original * rate * 100) / 100;
      exchangeRate = rate;
    } else {
      amountAud = amount_original;
    }

    const result = await db.execute({
      sql: `UPDATE income_entries
            SET date = ?, source = ?, amount_original = ?, currency_original = ?,
                exchange_rate = ?, amount_aud = ?, note = ?, category_id = ?
            WHERE id = ?
            RETURNING *`,
      args: [date, source, amount_original, currency_original, exchangeRate, amountAud, note ?? null, category_id ?? null, id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Income entry not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating income entry:', err);
    res.status(500).json({ error: 'Failed to update income entry' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/income/:id — delete an income entry
// ---------------------------------------------------------------------------

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    await db.execute({ sql: `DELETE FROM income_entries WHERE id = ?`, args: [id] });

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting income entry:', err);
    res.status(500).json({ error: 'Failed to delete income entry' });
  }
});

export default router;
