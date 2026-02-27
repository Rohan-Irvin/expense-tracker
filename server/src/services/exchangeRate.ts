import db from '../db/connection.js';

interface FrankfurterResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

export async function getExchangeRate(
  requestedDate: string,
  fromCurrency: string,
  toCurrency: string
): Promise<number> {
  // Same currency — no conversion needed
  if (fromCurrency === toCurrency) {
    return 1.0;
  }

  // Check cache first using requested_date as key
  const cached = await db.execute({
    sql: `SELECT rate FROM exchange_rate_cache
          WHERE requested_date = ? AND from_currency = ? AND to_currency = ?`,
    args: [requestedDate, fromCurrency, toCurrency],
  });

  if (cached.rows.length > 0) {
    return cached.rows[0].rate as number;
  }

  // Not cached — fetch from Frankfurter API
  const url = `https://api.frankfurter.dev/v1/${requestedDate}?from=${fromCurrency}&to=${toCurrency}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Frankfurter API error: ${response.status} ${response.statusText}`
    );
  }

  const data: FrankfurterResponse = await response.json();
  const rate = data.rates[toCurrency];

  if (rate === undefined) {
    throw new Error(
      `No rate found for ${toCurrency} in Frankfurter response`
    );
  }

  // Store in cache with both the actual trading date and the requested date
  await db.execute({
    sql: `INSERT OR REPLACE INTO exchange_rate_cache
            (date, requested_date, from_currency, to_currency, rate, fetched_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    args: [data.date, requestedDate, fromCurrency, toCurrency, rate],
  });

  return rate;
}
