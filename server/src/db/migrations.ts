import db from './connection.js';

export async function runMigrations(): Promise<void> {
  console.log('Running database migrations...');

  // 1. categories
  await db.execute(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    )
  `);

  // 2. accounts
  await db.execute(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL CHECK(currency IN ('AUD', 'USD')),
      created_at TEXT NOT NULL
    )
  `);

  // 3. import_batches
  await db.execute(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES accounts(id),
      filename TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending_review', 'approved', 'partial')),
      column_map TEXT NOT NULL
    )
  `);

  // 4. expenses
  await db.execute(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER REFERENCES import_batches(id),
      account_id INTEGER REFERENCES accounts(id),
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount_original REAL NOT NULL,
      currency_original TEXT NOT NULL CHECK(currency_original IN ('AUD', 'USD')),
      exchange_rate REAL,
      amount_aud REAL NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      subcategory_id INTEGER REFERENCES categories(id),
      split_parent_id INTEGER REFERENCES expenses(id),
      review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending', 'approved', 'skipped', 'split')),
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // 5. llm_suggestions
  await db.execute(`
    CREATE TABLE IF NOT EXISTS llm_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER REFERENCES expenses(id),
      suggested_category_id INTEGER REFERENCES categories(id),
      suggested_subcategory_id INTEGER REFERENCES categories(id),
      confidence TEXT CHECK(confidence IN ('high', 'medium', 'low', 'rule')),
      llm_reasoning TEXT,
      model_used TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // 6. income_entries
  await db.execute(`
    CREATE TABLE IF NOT EXISTS income_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      amount_original REAL NOT NULL,
      currency_original TEXT NOT NULL CHECK(currency_original IN ('AUD', 'USD')),
      exchange_rate REAL,
      amount_aud REAL NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('csv_import', 'manual')),
      batch_id INTEGER REFERENCES import_batches(id),
      note TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // 7. exchange_rate_cache
  await db.execute(`
    CREATE TABLE IF NOT EXISTS exchange_rate_cache (
      date TEXT NOT NULL,
      requested_date TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (requested_date, from_currency, to_currency)
    )
  `);

  // 8. amazon_orders
  await db.execute(`
    CREATE TABLE IF NOT EXISTS amazon_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL UNIQUE,
      order_date TEXT NOT NULL,
      total_owed REAL NOT NULL,
      currency TEXT NOT NULL,
      matched_expense_id INTEGER REFERENCES expenses(id),
      imported_at TEXT NOT NULL
    )
  `);

  // 9. amazon_order_items
  await db.execute(`
    CREATE TABLE IF NOT EXISTS amazon_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER REFERENCES amazon_orders(id),
      product_name TEXT NOT NULL,
      asin TEXT,
      amazon_category TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      item_subtotal REAL NOT NULL,
      suggested_category_id INTEGER REFERENCES categories(id),
      suggested_subcategory_id INTEGER REFERENCES categories(id)
    )
  `);

  // 10. merchant_rules
  await db.execute(`
    CREATE TABLE IF NOT EXISTS merchant_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description_pattern TEXT NOT NULL UNIQUE,
      category_id INTEGER REFERENCES categories(id) NOT NULL,
      subcategory_id INTEGER REFERENCES categories(id),
      match_count INTEGER NOT NULL DEFAULT 1,
      last_matched_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // 11. app_settings
  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Insert default settings if they don't exist
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('lm_studio_base_url', 'http://localhost:1234/v1')
  `);
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('lm_studio_model', 'qwen3.5-35b-a3b')
  `);
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('default_currency', 'AUD')
  `);
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('llm_batch_size', '10')
  `);
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('lm_studio_context_length', '20000')
  `);
  // Migrate: if batch size is still at the old default of 20, reduce to 10
  // (avoids "Context size exceeded" errors on models with small context windows)
  await db.execute(`
    UPDATE app_settings SET value = '10' WHERE key = 'llm_batch_size' AND value = '20'
  `);

  // Deduplicate llm_suggestions — keep only the latest row per expense_id.
  // Duplicates can occur when the import-wizard categorize step and the
  // review-page Resume Categorization run concurrently (e.g. the user
  // navigates away while an OpenAI request is still in-flight).
  // This runs on every startup; it's a no-op when there are no duplicates.
  await db.execute(`
    DELETE FROM llm_suggestions
    WHERE id NOT IN (
      SELECT MAX(id) FROM llm_suggestions GROUP BY expense_id
    )
  `);

  // LLM provider toggle and OpenAI settings
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('llm_provider', 'local')
  `);
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('openai_api_key', '')
  `);
  await db.execute(`
    INSERT OR IGNORE INTO app_settings (key, value) VALUES ('openai_model', 'gpt-4o-mini')
  `);

  // 12. income_categories — separate category list just for income entries
  await db.execute(`
    CREATE TABLE IF NOT EXISTS income_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )
  `);

  // Migration: add category_id to income_entries (kept for backwards compat, now unused)
  await db.execute(
    `ALTER TABLE income_entries ADD COLUMN category_id INTEGER REFERENCES categories(id)`
  ).catch(() => {});

  // Migration: add income_category_id referencing the new income_categories table
  await db.execute(
    `ALTER TABLE income_entries ADD COLUMN income_category_id INTEGER REFERENCES income_categories(id)`
  ).catch(() => {});

  // Migration: income detection — tag each expense row as 'expense' or 'income'
  await db.execute(
    `ALTER TABLE expenses ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'expense'`
  ).catch(() => {});

  // Migration: store the income category chosen during review (staging column, cleared at finalize)
  await db.execute(
    `ALTER TABLE expenses ADD COLUMN income_category_id INTEGER REFERENCES income_categories(id)`
  ).catch(() => {});

  // Migration: LLM-suggested income category on llm_suggestions
  await db.execute(
    `ALTER TABLE llm_suggestions ADD COLUMN suggested_income_category_id INTEGER REFERENCES income_categories(id)`
  ).catch(() => {});

  console.log('Database migrations completed successfully.');
}
