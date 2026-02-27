import { Router, Request, Response } from 'express';
import multer from 'multer';
import db from '../db/connection.js';
import { parseAmazonCsv, runAmazonMatching } from '../services/amazonMatcher.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ---------------------------------------------------------------------------
// POST /api/amazon/import — upload Amazon CSV, parse and store
// ---------------------------------------------------------------------------

router.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { orders, items } = await parseAmazonCsv(req.file.buffer);

    let ordersImported = 0;
    let itemsImported = 0;

    for (const order of orders) {
      // Skip duplicates using INSERT OR IGNORE on order_id (unique)
      const result = await db.execute({
        sql: `INSERT OR IGNORE INTO amazon_orders (order_id, order_date, total_owed, currency, imported_at)
              VALUES (?, ?, ?, ?, datetime('now'))`,
        args: [order.order_id, order.order_date, order.total_owed, order.currency],
      });

      if (result.rowsAffected > 0) {
        ordersImported++;
      }
    }

    // Fetch all order id mappings (order_id text -> database id) for item insertion
    const orderRows = await db.execute({
      sql: `SELECT id, order_id FROM amazon_orders`,
      args: [],
    });

    const orderIdMap = new Map<string, number>();
    for (const row of orderRows.rows) {
      const r = row as unknown as { id: number; order_id: string };
      orderIdMap.set(r.order_id, r.id);
    }

    for (const item of items) {
      const dbOrderId = orderIdMap.get(item.order_id);
      if (dbOrderId === undefined) continue;

      await db.execute({
        sql: `INSERT INTO amazon_order_items (order_id, product_name, asin, quantity, unit_price, item_subtotal)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [dbOrderId, item.product_name, item.asin, item.quantity, item.unit_price, item.item_subtotal],
      });

      itemsImported++;
    }

    res.json({ ordersImported, itemsImported });
  } catch (err) {
    console.error('Error importing Amazon CSV:', err);
    res.status(500).json({ error: 'Failed to import Amazon CSV' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/amazon/match — run matching
// ---------------------------------------------------------------------------

router.post('/match', async (_req: Request, res: Response) => {
  try {
    const matches = await runAmazonMatching();
    res.json(matches);
  } catch (err) {
    console.error('Error running Amazon matching:', err);
    res.status(500).json({ error: 'Failed to run Amazon matching' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/amazon/orders — list orders with match status
// ---------------------------------------------------------------------------

router.get('/orders', async (_req: Request, res: Response) => {
  try {
    const ordersResult = await db.execute({
      sql: `SELECT ao.*,
              e.date as expense_date, e.description as expense_description, e.amount_aud as expense_amount_aud
            FROM amazon_orders ao
            LEFT JOIN expenses e ON ao.matched_expense_id = e.id
            ORDER BY ao.order_date DESC`,
      args: [],
    });

    const orders = ordersResult.rows as unknown as any[];

    // Fetch items for each order
    for (const order of orders) {
      const itemsResult = await db.execute({
        sql: `SELECT * FROM amazon_order_items WHERE order_id = ?`,
        args: [order.id],
      });
      order.items = itemsResult.rows;
    }

    res.json(orders);
  } catch (err) {
    console.error('Error fetching Amazon orders:', err);
    res.status(500).json({ error: 'Failed to fetch Amazon orders' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/amazon/orders/:orderId/confirm-match — confirm a match
// ---------------------------------------------------------------------------

router.patch('/orders/:orderId/confirm-match', async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }

    const { expense_id } = req.body;
    if (!expense_id) {
      return res.status(400).json({ error: 'expense_id is required' });
    }

    const result = await db.execute({
      sql: `UPDATE amazon_orders SET matched_expense_id = ? WHERE id = ? RETURNING *`,
      args: [expense_id, orderId],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Amazon order not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error confirming Amazon match:', err);
    res.status(500).json({ error: 'Failed to confirm match' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/amazon/orders/:orderId/unmatch — remove a match
// ---------------------------------------------------------------------------

router.patch('/orders/:orderId/unmatch', async (req: Request, res: Response) => {
  try {
    const orderId = parseInt(req.params.orderId as string, 10);
    if (isNaN(orderId)) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }

    const result = await db.execute({
      sql: `UPDATE amazon_orders SET matched_expense_id = NULL WHERE id = ? RETURNING *`,
      args: [orderId],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Amazon order not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error unmatching Amazon order:', err);
    res.status(500).json({ error: 'Failed to unmatch order' });
  }
});

export default router;
