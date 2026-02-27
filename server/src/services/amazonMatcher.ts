import { parse } from 'csv-parse/sync';
import db from '../db/connection.js';

export interface MatchResult {
  amazon_order_id: number;
  order_id_text: string;
  expense_id: number;
  confidence: 'high' | 'low';
  date_diff_days: number;
  amount_diff_pct: number;
}

// ---------------------------------------------------------------------------
// parseAmazonCsv — parse Amazon Retail.OrderHistory CSV
// ---------------------------------------------------------------------------

export async function parseAmazonCsv(
  fileBuffer: Buffer
): Promise<{ orders: any[]; items: any[] }> {
  const csvString = fileBuffer.toString('utf-8');

  const rows: Record<string, string>[] = parse(csvString, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  // Group rows by Order ID
  const orderGroups = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const orderId = row['Order ID'];
    if (!orderId) continue;

    if (!orderGroups.has(orderId)) {
      orderGroups.set(orderId, []);
    }
    orderGroups.get(orderId)!.push(row);
  }

  const orders: any[] = [];
  const items: any[] = [];

  for (const [orderId, groupRows] of orderGroups) {
    // Use the first row to extract order-level data
    const firstRow = groupRows[0];

    const order = {
      order_id: orderId,
      order_date: firstRow['Order Date'] ?? '',
      total_owed: stripCurrency(firstRow['Total Owed'] ?? '0'),
      currency: firstRow['Currency'] ?? 'AUD',
    };
    orders.push(order);

    // Each row is an item
    for (const row of groupRows) {
      const item = {
        order_id: orderId,
        product_name: row['Product Name'] ?? '',
        asin: row['ASIN'] ?? '',
        quantity: parseInt(stripCurrency(row['Quantity'] ?? '1'), 10) || 1,
        unit_price: stripCurrency(row['Unit Price'] ?? '0'),
        item_subtotal: stripCurrency(row['Shipment Item Subtotal'] ?? '0'),
      };
      items.push(item);
    }
  }

  return { orders, items };
}

// ---------------------------------------------------------------------------
// runAmazonMatching — match unmatched orders to expenses
// ---------------------------------------------------------------------------

export async function runAmazonMatching(): Promise<MatchResult[]> {
  // Fetch all unmatched amazon orders
  const unmatchedResult = await db.execute({
    sql: `SELECT * FROM amazon_orders WHERE matched_expense_id IS NULL`,
    args: [],
  });

  const unmatchedOrders = unmatchedResult.rows as unknown as {
    id: number;
    order_id: string;
    order_date: string;
    total_owed: number;
    currency: string;
  }[];

  const allMatches: MatchResult[] = [];

  for (const order of unmatchedOrders) {
    // Find candidate expenses within 3 days of order date with 'amazon' in description
    const candidatesResult = await db.execute({
      sql: `SELECT * FROM expenses
            WHERE LOWER(description) LIKE '%amazon%'
              AND ABS(julianday(date) - julianday(?)) <= 3
              AND review_status IN ('pending', 'approved')`,
      args: [order.order_date],
    });

    const candidates = candidatesResult.rows as unknown as {
      id: number;
      date: string;
      amount_aud: number;
      description: string;
    }[];

    // Filter by amount tolerance
    const validCandidates: {
      expense_id: number;
      date_diff_days: number;
      amount_diff_pct: number;
    }[] = [];

    for (const candidate of candidates) {
      const dateDiffDays = Math.abs(
        (new Date(candidate.date).getTime() - new Date(order.order_date).getTime()) /
          (1000 * 60 * 60 * 24)
      );

      const amountDiffPct =
        order.total_owed === 0
          ? 0
          : Math.abs(candidate.amount_aud - order.total_owed) / order.total_owed;

      if (amountDiffPct <= 0.02) {
        validCandidates.push({
          expense_id: candidate.id,
          date_diff_days: Math.round(dateDiffDays * 100) / 100,
          amount_diff_pct: Math.round(amountDiffPct * 10000) / 10000,
        });
      }
    }

    // Determine confidence
    const confidence: 'high' | 'low' =
      validCandidates.length === 1 ? 'high' : 'low';

    for (const match of validCandidates) {
      allMatches.push({
        amazon_order_id: order.id,
        order_id_text: order.order_id,
        expense_id: match.expense_id,
        confidence,
        date_diff_days: match.date_diff_days,
        amount_diff_pct: match.amount_diff_pct,
      });
    }
  }

  return allMatches;
}

// ---------------------------------------------------------------------------
// Helper: strip currency symbols and commas from numeric strings
// ---------------------------------------------------------------------------

function stripCurrency(value: string): number {
  // Remove currency symbols ($, AUD, USD, etc.), commas, and whitespace
  const cleaned = value.replace(/[^0-9.\-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}
