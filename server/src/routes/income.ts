import { Router, Request, Response } from 'express';
import multer from 'multer';
import db from '../db/connection.js';
import { parseCsvFile } from '../services/csvParser.js';
import { getExchangeRate } from '../services/exchangeRate.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// GET /api/income — list all income entries
// ---------------------------------------------------------------------------

router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute({
      sql: `SELECT * FROM income_entries ORDER BY date DESC`,
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
    const { date, source, amount_original, currency_original, note } = req.body;

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
      sql: `INSERT INTO income_entries (date, source, amount_original, currency_original, exchange_rate, amount_aud, entry_type, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, datetime('now'))
            RETURNING *`,
      args: [date, source, amount_original, currency_original, exchangeRate, amountAud, note ?? null],
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
      const date = (row[columnMap.date] ?? '').trim();
      const source = (row[columnMap.description] ?? '').trim();
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

export default router;
