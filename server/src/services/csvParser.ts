import { parse } from 'csv-parse/sync';
import db from '../db/connection.js';
import type { ColumnMap, CsvParseResult } from '../types/index.js';

export interface ParsedExpenseRow {
  date: string;       // YYYY-MM-DD
  description: string;
  amount: number;     // always positive
  transaction_type: 'expense' | 'income';
}

// ---------------------------------------------------------------------------
// Date parsing helper
// ---------------------------------------------------------------------------

function parseDate(value: string, format: string): string {
  const trimmed = value.trim();

  switch (format) {
    case 'DD/MM/YYYY': {
      const parts = trimmed.split('/');
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
    case 'MM/DD/YYYY': {
      const parts = trimmed.split('/');
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }
    case 'YYYYMMDD': {
      const year = trimmed.substring(0, 4);
      const month = trimmed.substring(4, 6);
      const day = trimmed.substring(6, 8);
      return `${year}-${month}-${day}`;
    }
    default:
      throw new Error(`Unsupported date format: ${format}`);
  }
}

// ---------------------------------------------------------------------------
// Heuristic: does a string look like data rather than a header label?
// ---------------------------------------------------------------------------

function looksLikeData(value: string): boolean {
  const trimmed = value.trim();
  // Contains digits (dates, amounts, IDs)
  if (/\d/.test(trimmed)) return true;
  // Looks like a date pattern
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) return true;
  if (/^\d{8}$/.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Auto-detect bank pattern from column names
// ---------------------------------------------------------------------------

function detectBankMapping(
  columns: string[],
  hasHeader: boolean
): Partial<ColumnMap> | null {
  const lower = columns.map((c) => c.toLowerCase());

  if (hasHeader) {
    // ANZ: "Transaction Date", "Transaction Description", "Debits", "Credits"
    if (
      lower.some((c) => c.includes('transaction date')) &&
      lower.some((c) => c.includes('transaction description')) &&
      lower.some((c) => c.includes('debits')) &&
      lower.some((c) => c.includes('credits'))
    ) {
      return {
        hasHeader: true,
        date: columns.find((c) => c.toLowerCase().includes('transaction date'))!,
        description: columns.find((c) =>
          c.toLowerCase().includes('transaction description')
        )!,
        amount_type: 'split',
        debit: columns.find((c) => c.toLowerCase().includes('debits'))!,
        credit: columns.find((c) => c.toLowerCase().includes('credits'))!,
        dateFormat: 'DD/MM/YYYY',
      };
    }

    // CBA: "Date", "Description", "Debit", "Credit"
    if (
      lower.some((c) => c === 'date') &&
      lower.some((c) => c === 'description') &&
      lower.some((c) => c === 'debit') &&
      lower.some((c) => c === 'credit')
    ) {
      return {
        hasHeader: true,
        date: columns.find((c) => c.toLowerCase() === 'date')!,
        description: columns.find((c) => c.toLowerCase() === 'description')!,
        amount_type: 'split',
        debit: columns.find((c) => c.toLowerCase() === 'debit')!,
        credit: columns.find((c) => c.toLowerCase() === 'credit')!,
        dateFormat: 'DD/MM/YYYY',
      };
    }

    // Westpac: "TRAN_DATE", "NARRATIVE", "AMOUNT"
    if (
      lower.some((c) => c === 'tran_date') &&
      lower.some((c) => c === 'narrative') &&
      lower.some((c) => c === 'amount')
    ) {
      return {
        hasHeader: true,
        date: columns.find((c) => c.toLowerCase() === 'tran_date')!,
        description: columns.find((c) => c.toLowerCase() === 'narrative')!,
        amount_type: 'single',
        amount: columns.find((c) => c.toLowerCase() === 'amount')!,
        dateFormat: 'YYYYMMDD',
        sign_convention: 'positive_is_debit',
      };
    }
  }

  // Wells Fargo: no header, exactly 5 columns
  if (!hasHeader && columns.length === 5) {
    return {
      hasHeader: false,
      date: 'col_0',
      description: 'col_1',
      amount_type: 'split',
      debit: 'col_2',
      credit: 'col_3',
      dateFormat: 'MM/DD/YYYY',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// parseCsvFile — detect headers, sample rows, suggest mapping
// ---------------------------------------------------------------------------

export async function parseCsvFile(
  fileBuffer: Buffer,
  accountId: number
): Promise<CsvParseResult> {
  const csvString = fileBuffer.toString('utf-8');

  // First, try parsing with columns: true (treats first row as header)
  let hasHeader = true;
  let columns: string[];
  let allRows: Record<string, string>[];

  try {
    const withHeader: Record<string, string>[] = parse(csvString, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    if (withHeader.length === 0) {
      throw new Error('Empty CSV');
    }

    columns = Object.keys(withHeader[0]);

    // Check if the "header" row actually looks like data
    const firstRowValues = columns;
    const dataLikeCount = firstRowValues.filter(looksLikeData).length;

    if (dataLikeCount > firstRowValues.length / 2) {
      // First row looks like data, not headers — re-parse without header
      hasHeader = false;
    } else {
      allRows = withHeader;
    }
  } catch {
    hasHeader = false;
  }

  if (!hasHeader) {
    const withoutHeader: string[][] = parse(csvString, {
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true,
    });

    if (withoutHeader.length === 0) {
      throw new Error('Empty CSV');
    }

    const colCount = withoutHeader[0].length;
    columns = Array.from({ length: colCount }, (_, i) => `col_${i}`);

    allRows = withoutHeader.map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < colCount; i++) {
        obj[columns[i]] = row[i] ?? '';
      }
      return obj;
    });
  }

  const sampleRows = allRows!.slice(0, 5);

  // Try auto-detection from column names / structure
  let suggestedMapping = detectBankMapping(columns!, hasHeader);

  // If no auto-detection match, check for a previous import on this account
  if (!suggestedMapping) {
    const prev = await db.execute({
      sql: `SELECT column_map FROM import_batches
            WHERE account_id = ?
            ORDER BY imported_at DESC
            LIMIT 1`,
      args: [accountId],
    });

    if (prev.rows.length > 0 && prev.rows[0].column_map) {
      try {
        suggestedMapping = JSON.parse(prev.rows[0].column_map as string) as Partial<ColumnMap>;
      } catch {
        // Ignore invalid JSON in stored column_map
      }
    }
  }

  return {
    hasHeader,
    columns: columns!,
    sampleRows,
    suggestedMapping,
  };
}

// ---------------------------------------------------------------------------
// applyColumnMap — parse full CSV with confirmed mapping
// ---------------------------------------------------------------------------

export function applyColumnMap(
  fileBuffer: Buffer,
  columnMap: ColumnMap
): ParsedExpenseRow[] {
  const csvString = fileBuffer.toString('utf-8');

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

    rows = raw.map((row) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < colCount; i++) {
        obj[colNames[i]] = row[i] ?? '';
      }
      return obj;
    });
  }

  return rows.map((row) => {
    const date = parseDate(row[columnMap.date] ?? '', columnMap.dateFormat);
    const description = (row[columnMap.description] ?? '').trim();

    let amount: number;
    let transaction_type: 'expense' | 'income';

    if (columnMap.amount_type === 'split') {
      // Strip everything except digits, dot and minus (handles $, £, spaces, commas, etc.)
      const debitStr = (row[columnMap.debit!] ?? '').replace(/[^0-9.\-]/g, '').trim();
      const creditStr = (row[columnMap.credit!] ?? '').replace(/[^0-9.\-]/g, '').trim();

      const debitVal = debitStr ? parseFloat(debitStr) : 0;
      const creditVal = creditStr ? parseFloat(creditStr) : 0;

      // Debit column populated → money out (expense); credit column → money in (income)
      transaction_type = debitVal !== 0 ? 'expense' : 'income';
      amount = transaction_type === 'expense' ? Math.abs(debitVal) : Math.abs(creditVal);
    } else {
      // Single signed column — strip everything except digits, dot and minus
      const rawAmount = (row[columnMap.amount!] ?? '').replace(/[^0-9.\-]/g, '').trim();
      const parsed = parseFloat(rawAmount);

      if (columnMap.sign_convention === 'negative_is_debit') {
        // negative = money out (expense), positive = money in (income)
        transaction_type = parsed < 0 ? 'expense' : 'income';
      } else {
        // positive_is_debit (default): positive = money out (expense), negative = money in (income)
        transaction_type = parsed > 0 ? 'expense' : 'income';
      }
      amount = Math.abs(parsed);
    }

    return { date, description, amount, transaction_type };
  });
}
