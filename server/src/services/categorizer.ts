import db from '../db/connection.js';
import { categorizeBatch, categorizeIncomeBatch } from './llm.js';
import type { Category, CategoryWithChildren, Expense } from '../types/index.js';

// ---------------------------------------------------------------------------
// normalizeDescription — used for merchant rule matching
// ---------------------------------------------------------------------------

export function normalizeDescription(description: string): string {
  let normalized = description.toUpperCase();
  // Strip all digit sequences
  normalized = normalized.replace(/\d+/g, '');
  // Strip common Australian state abbreviations at word boundaries
  normalized = normalized.replace(/\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/g, '');
  // Collapse multiple spaces and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();
  // Take the first 30 characters
  return normalized.substring(0, 30);
}

// ---------------------------------------------------------------------------
// Helper: fetch full category tree from DB
// ---------------------------------------------------------------------------

async function fetchCategoryTree(): Promise<CategoryWithChildren[]> {
  const result = await db.execute('SELECT * FROM categories ORDER BY name');
  const categories = result.rows as unknown as Category[];

  const topLevel: CategoryWithChildren[] = [];
  const childMap = new Map<number, Category[]>();

  for (const cat of categories) {
    if (cat.parent_id === null) {
      topLevel.push({ ...cat, children: [] });
    } else {
      if (!childMap.has(cat.parent_id)) {
        childMap.set(cat.parent_id, []);
      }
      childMap.get(cat.parent_id)!.push(cat);
    }
  }

  for (const parent of topLevel) {
    parent.children = childMap.get(parent.id) || [];
  }

  return topLevel;
}

// ---------------------------------------------------------------------------
// Helper: fetch app settings
// ---------------------------------------------------------------------------

async function fetchSettings(): Promise<{
  lm_studio_base_url: string;
  lm_studio_model: string;
  llm_batch_size: number;
  lm_studio_context_length: number;
  llm_provider: 'local' | 'openai';
  openai_api_key: string;
  openai_model: string;
}> {
  const result = await db.execute('SELECT key, value FROM app_settings');
  const settings: Record<string, string> = {};
  for (const row of result.rows) {
    const r = row as unknown as { key: string; value: string };
    settings[r.key] = r.value;
  }
  return {
    lm_studio_base_url: settings.lm_studio_base_url || 'http://localhost:1234/v1',
    lm_studio_model: settings.lm_studio_model || 'qwen3.5-35b-a3b',
    llm_batch_size: parseInt(settings.llm_batch_size || '10', 10),
    lm_studio_context_length: parseInt(settings.lm_studio_context_length || '20000', 10),
    llm_provider: (settings.llm_provider === 'openai' ? 'openai' : 'local') as 'local' | 'openai',
    openai_api_key: settings.openai_api_key || '',
    openai_model: settings.openai_model || 'gpt-4o-mini',
  };
}

// ---------------------------------------------------------------------------
// categorizeBatchExpenses — main two-pass pipeline
// ---------------------------------------------------------------------------

export async function categorizeBatchExpenses(
  batchId: number,
  progressCallback?: (done: number, total: number) => void
): Promise<void> {
  // 1. Fetch all pending expenses for this batch
  const pendingResult = await db.execute({
    sql: `SELECT * FROM expenses WHERE batch_id = ? AND review_status = 'pending'`,
    args: [batchId],
  });
  const allPending = pendingResult.rows as unknown as Expense[];

  if (allPending.length === 0) {
    return;
  }

  const totalExpenses = allPending.length;

  // Check for a prior partial run — expenses that were already LLM-processed
  // stay 'pending' (awaiting user approval) but already have an llm_suggestions row.
  // On resume we skip those so they aren't re-sent to the LLM unnecessarily.
  const pendingIds = allPending.map((e) => e.id);
  const alreadySuggestedResult = await db.execute({
    sql: `SELECT DISTINCT expense_id FROM llm_suggestions WHERE expense_id IN (${pendingIds.map(() => '?').join(',')})`,
    args: pendingIds,
  });
  const alreadySuggestedIds = new Set(
    (alreadySuggestedResult.rows as unknown as { expense_id: number }[]).map((r) => r.expense_id)
  );

  // Only process expenses that haven't been handled by either pass yet
  const toProcess = allPending.filter((e) => !alreadySuggestedIds.has(e.id));
  let doneCount = alreadySuggestedIds.size;

  // Report initial progress so the frontend shows already-completed work on resume
  if (progressCallback) {
    progressCallback(doneCount, totalExpenses);
  }

  if (toProcess.length === 0) {
    return; // All expenses were processed in a prior run — nothing left to do
  }

  // 2. Fetch the full category tree
  const categoryTree = await fetchCategoryTree();

  // 3. Fetch app settings
  const settings = await fetchSettings();

  // ------------------------------------------------------------------
  // Pass 1 — Merchant Rule Matching
  // ------------------------------------------------------------------
  const ruleMatchedIds = new Set<number>();
  const remainingExpenses: Expense[] = [];

  for (const expense of toProcess) {
    const normalized = normalizeDescription(expense.description);

    const ruleResult = await db.execute({
      sql: `SELECT * FROM merchant_rules WHERE description_pattern = ? LIMIT 1`,
      args: [normalized],
    });

    if (ruleResult.rows.length > 0) {
      const rule = ruleResult.rows[0] as unknown as {
        id: number;
        category_id: number;
        subcategory_id: number | null;
        description_pattern: string;
      };

      // Update expense with rule match
      await db.execute({
        sql: `UPDATE expenses SET category_id = ?, subcategory_id = ?, review_status = 'approved', updated_at = datetime('now')
              WHERE id = ?`,
        args: [rule.category_id, rule.subcategory_id, expense.id],
      });

      // Insert into llm_suggestions with confidence = 'rule'
      // WHERE NOT EXISTS prevents a duplicate row if two categorize-next
      // calls race (e.g. import-wizard step vs. review-page resume button).
      await db.execute({
        sql: `INSERT INTO llm_suggestions (expense_id, suggested_category_id, suggested_subcategory_id, confidence, llm_reasoning, model_used, created_at)
              SELECT ?, ?, ?, 'rule', ?, 'rule-engine', datetime('now')
              WHERE NOT EXISTS (SELECT 1 FROM llm_suggestions WHERE expense_id = ?)`,
        args: [expense.id, rule.category_id, rule.subcategory_id, `Matched merchant rule: ${rule.description_pattern}`, expense.id],
      });

      // Update rule match count
      await db.execute({
        sql: `UPDATE merchant_rules SET match_count = match_count + 1, last_matched_at = datetime('now') WHERE id = ?`,
        args: [rule.id],
      });

      ruleMatchedIds.add(expense.id);
      doneCount++;
    } else {
      remainingExpenses.push(expense);
    }
  }

  if (progressCallback) {
    progressCallback(doneCount, totalExpenses);
  }

  if (remainingExpenses.length === 0) {
    return;
  }

  // ------------------------------------------------------------------
  // Pass 2 — LLM Categorization
  // ------------------------------------------------------------------

  // 7. Get few-shot examples
  const fewShotResult = await db.execute({
    sql: `SELECT e.description, c1.name as category_name, c2.name as subcategory_name,
                 e.category_id, e.subcategory_id, e.updated_at
          FROM expenses e
          LEFT JOIN categories c1 ON e.category_id = c1.id
          LEFT JOIN categories c2 ON e.subcategory_id = c2.id
          WHERE e.review_status = 'approved'
            AND e.split_parent_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM llm_suggestions ls WHERE ls.expense_id = e.id AND ls.confidence = 'rule')
          ORDER BY e.updated_at DESC`,
    args: [],
  });

  // Group by category_id+subcategory_id, take max 2 per group, cap at 60 total
  const fewShotRows = fewShotResult.rows as unknown as {
    description: string;
    category_name: string;
    subcategory_name: string | null;
    category_id: number;
    subcategory_id: number | null;
  }[];

  const groupCounts = new Map<string, number>();
  const fewShotExamples: { description: string; category_name: string; subcategory_name: string | null }[] = [];

  for (const row of fewShotRows) {
    if (fewShotExamples.length >= 60) break;

    const groupKey = `${row.category_id}-${row.subcategory_id ?? 'null'}`;
    const currentCount = groupCounts.get(groupKey) || 0;

    if (currentCount < 2) {
      fewShotExamples.push({
        description: row.description,
        category_name: row.category_name,
        subcategory_name: row.subcategory_name,
      });
      groupCounts.set(groupKey, currentCount + 1);
    }
  }

  // 8. Check for Amazon order matches — replace descriptions with product names
  const remainingIds = remainingExpenses.map((e) => e.id);
  const placeholders = remainingIds.map(() => '?').join(',');

  let amazonMap = new Map<number, string>();
  if (remainingIds.length > 0) {
    const amazonResult = await db.execute({
      sql: `SELECT ao.matched_expense_id, GROUP_CONCAT(aoi.product_name, ', ') as products
            FROM amazon_orders ao
            JOIN amazon_order_items aoi ON aoi.order_id = ao.id
            WHERE ao.matched_expense_id IN (${placeholders})
            GROUP BY ao.matched_expense_id`,
      args: remainingIds,
    });

    for (const row of amazonResult.rows) {
      const r = row as unknown as { matched_expense_id: number; products: string };
      amazonMap.set(r.matched_expense_id, r.products);
    }
  }

  // 9. Build expense objects for LLM, applying Amazon overrides
  const expensesForLlm = remainingExpenses.map((e) => {
    const amazonProducts = amazonMap.get(e.id);
    return {
      id: e.id,
      date: e.date,
      description: amazonProducts ? `Amazon order: ${amazonProducts}` : e.description,
      amount_aud: e.amount_aud,
    };
  });

  // Prepare category tree in the format the LLM service expects
  const treeForLlm = categoryTree.map((cat) => ({
    id: cat.id,
    name: cat.name,
    children: cat.children.map((child) => ({ id: child.id, name: child.name })),
  }));

  // 10. Split into batches and process
  const batchSize = settings.llm_batch_size;
  const modelUsed = settings.llm_provider === 'openai' ? settings.openai_model : settings.lm_studio_model;
  for (let i = 0; i < expensesForLlm.length; i += batchSize) {
    const batch = expensesForLlm.slice(i, i + batchSize);

    const results = await categorizeBatch(batch, treeForLlm, fewShotExamples, {
      provider: settings.llm_provider,
      baseUrl: settings.lm_studio_base_url,
      model: settings.lm_studio_model,
      contextLength: settings.lm_studio_context_length,
      apiKey: settings.openai_api_key,
      openaiModel: settings.openai_model,
    });

    // 11. For each result, insert suggestion and update expense
    for (const result of results) {
      await db.execute({
        sql: `INSERT INTO llm_suggestions (expense_id, suggested_category_id, suggested_subcategory_id, confidence, llm_reasoning, model_used, created_at)
              SELECT ?, ?, ?, ?, ?, ?, datetime('now')
              WHERE NOT EXISTS (SELECT 1 FROM llm_suggestions WHERE expense_id = ?)`,
        args: [result.expense_id, result.category_id, result.subcategory_id, result.confidence, result.reasoning, modelUsed, result.expense_id],
      });

      // Set category on the expense but keep review_status = 'pending'
      await db.execute({
        sql: `UPDATE expenses SET category_id = ?, subcategory_id = ?, updated_at = datetime('now')
              WHERE id = ?`,
        args: [result.category_id, result.subcategory_id, result.expense_id],
      });
    }

    doneCount += batch.length;

    // 12. Progress callback
    if (progressCallback) {
      progressCallback(doneCount, totalExpenses);
    }
  }
}

// ---------------------------------------------------------------------------
// categorizeNextBatch — process ONE LLM batch and return (used by resume)
// ---------------------------------------------------------------------------
// Unlike categorizeBatchExpenses (SSE, processes ALL batches in one call),
// this function processes at most one LLM batch per invocation and returns
// a plain JSON result. The frontend calls it in a loop. Because each call
// is a normal short-lived request (30-120s), there are no proxy/timeout/SSE
// issues that plague the streaming approach.
// ---------------------------------------------------------------------------

export async function categorizeNextBatch(batchId: number): Promise<{
  done: number;
  total: number;
  remaining: number;
}> {
  // 1. Fetch all pending expenses for this batch
  const pendingResult = await db.execute({
    sql: `SELECT * FROM expenses WHERE batch_id = ? AND review_status = 'pending'`,
    args: [batchId],
  });
  const allPending = pendingResult.rows as unknown as Expense[];
  const total = allPending.length;

  if (total === 0) {
    return { done: 0, total: 0, remaining: 0 };
  }

  // 2. Find already-processed (have llm_suggestions row)
  const pendingIds = allPending.map((e) => e.id);
  const suggestedResult = await db.execute({
    sql: `SELECT DISTINCT expense_id FROM llm_suggestions WHERE expense_id IN (${pendingIds.map(() => '?').join(',')})`,
    args: pendingIds,
  });
  const alreadySuggestedIds = new Set(
    (suggestedResult.rows as unknown as { expense_id: number }[]).map((r) => r.expense_id)
  );

  const toProcess = allPending.filter((e) => !alreadySuggestedIds.has(e.id));
  let done = alreadySuggestedIds.size;

  if (toProcess.length === 0) {
    return { done, total, remaining: 0 };
  }

  // 3. Fetch category tree, income categories, and settings
  const categoryTree = await fetchCategoryTree();
  const settings = await fetchSettings();

  const incomeCatResult = await db.execute(`SELECT id, name FROM income_categories ORDER BY name ASC`);
  const incomeCategories = incomeCatResult.rows as unknown as { id: number; name: string }[];

  // Split unprocessed rows by transaction type
  const incomeToProcess = toProcess.filter((e) => (e as any).transaction_type === 'income');
  const expenseToProcess = toProcess.filter((e) => (e as any).transaction_type !== 'income');

  const modelUsed = settings.llm_provider === 'openai' ? settings.openai_model : settings.lm_studio_model;
  const llmSettings = {
    provider: settings.llm_provider,
    baseUrl: settings.lm_studio_base_url,
    model: settings.lm_studio_model,
    contextLength: settings.lm_studio_context_length,
    apiKey: settings.openai_api_key,
    openaiModel: settings.openai_model,
  };

  // -------------------------------------------------------------------------
  // 4a. Income pass — skip merchant rules, categorize with income LLM
  // -------------------------------------------------------------------------
  const batchSize = settings.llm_batch_size;
  const incomeBatch = incomeToProcess.slice(0, batchSize);

  if (incomeBatch.length > 0 && incomeCategories.length > 0) {
    const incomeForLlm = incomeBatch.map((e) => ({
      id: e.id, date: e.date, description: e.description, amount_aud: e.amount_aud,
    }));

    const incomeResults = await categorizeIncomeBatch(incomeForLlm, incomeCategories, llmSettings);

    for (const result of incomeResults) {
      await db.execute({
        sql: `INSERT INTO llm_suggestions (expense_id, suggested_income_category_id, confidence, llm_reasoning, model_used, created_at)
              SELECT ?, ?, ?, ?, ?, datetime('now')
              WHERE NOT EXISTS (SELECT 1 FROM llm_suggestions WHERE expense_id = ?)`,
        args: [result.expense_id, result.income_category_id, result.confidence, result.reasoning, modelUsed, result.expense_id],
      });
    }
  } else if (incomeBatch.length > 0) {
    // No income categories configured — insert a placeholder so they're marked processed
    for (const e of incomeBatch) {
      await db.execute({
        sql: `INSERT INTO llm_suggestions (expense_id, confidence, llm_reasoning, model_used, created_at)
              SELECT ?, 'low', 'No income categories configured', 'none', datetime('now')
              WHERE NOT EXISTS (SELECT 1 FROM llm_suggestions WHERE expense_id = ?)`,
        args: [e.id, e.id],
      });
    }
  }

  done += incomeBatch.length;

  // -------------------------------------------------------------------------
  // 4b. Expense pass — Merchant Rule Matching
  // -------------------------------------------------------------------------
  const remainingExpenses: Expense[] = [];

  for (const expense of expenseToProcess) {
    const normalized = normalizeDescription(expense.description);
    const ruleResult = await db.execute({
      sql: `SELECT * FROM merchant_rules WHERE description_pattern = ? LIMIT 1`,
      args: [normalized],
    });

    if (ruleResult.rows.length > 0) {
      const rule = ruleResult.rows[0] as unknown as {
        id: number; category_id: number; subcategory_id: number | null; description_pattern: string;
      };
      await db.execute({
        sql: `UPDATE expenses SET category_id = ?, subcategory_id = ?, review_status = 'approved', updated_at = datetime('now') WHERE id = ?`,
        args: [rule.category_id, rule.subcategory_id, expense.id],
      });
      await db.execute({
        sql: `INSERT INTO llm_suggestions (expense_id, suggested_category_id, suggested_subcategory_id, confidence, llm_reasoning, model_used, created_at)
              SELECT ?, ?, ?, 'rule', ?, 'rule-engine', datetime('now')
              WHERE NOT EXISTS (SELECT 1 FROM llm_suggestions WHERE expense_id = ?)`,
        args: [expense.id, rule.category_id, rule.subcategory_id, `Matched merchant rule: ${rule.description_pattern}`, expense.id],
      });
      await db.execute({
        sql: `UPDATE merchant_rules SET match_count = match_count + 1, last_matched_at = datetime('now') WHERE id = ?`,
        args: [rule.id],
      });
      done++;
    } else {
      remainingExpenses.push(expense);
    }
  }

  // -------------------------------------------------------------------------
  // 5. Few-shot examples (for expense LLM only)
  // -------------------------------------------------------------------------
  const fewShotResult = await db.execute({
    sql: `SELECT e.description, c1.name as category_name, c2.name as subcategory_name,
                 e.category_id, e.subcategory_id
          FROM expenses e
          LEFT JOIN categories c1 ON e.category_id = c1.id
          LEFT JOIN categories c2 ON e.subcategory_id = c2.id
          WHERE e.review_status = 'approved'
            AND e.split_parent_id IS NULL
            AND e.transaction_type != 'income'
            AND NOT EXISTS (SELECT 1 FROM llm_suggestions ls WHERE ls.expense_id = e.id AND ls.confidence = 'rule')
          ORDER BY e.updated_at DESC`,
    args: [],
  });
  const fewShotRows = fewShotResult.rows as unknown as {
    description: string; category_name: string; subcategory_name: string | null;
    category_id: number; subcategory_id: number | null;
  }[];

  const groupCounts = new Map<string, number>();
  const fewShotExamples: { description: string; category_name: string; subcategory_name: string | null }[] = [];
  for (const row of fewShotRows) {
    if (fewShotExamples.length >= 60) break;
    const groupKey = `${row.category_id}-${row.subcategory_id ?? 'null'}`;
    const currentCount = groupCounts.get(groupKey) || 0;
    if (currentCount < 2) {
      fewShotExamples.push({ description: row.description, category_name: row.category_name, subcategory_name: row.subcategory_name });
      groupCounts.set(groupKey, currentCount + 1);
    }
  }

  if (remainingExpenses.length === 0) {
    const remaining = incomeToProcess.length - incomeBatch.length;
    return { done, total, remaining };
  }

  // 6. Take ONE batch worth of expenses for LLM
  const batch = remainingExpenses.slice(0, batchSize);
  const batchIds = batch.map((e) => e.id);

  // 7. Amazon order matching (only for this batch)
  let amazonMap = new Map<number, string>();
  if (batchIds.length > 0) {
    const amazonResult = await db.execute({
      sql: `SELECT ao.matched_expense_id, GROUP_CONCAT(aoi.product_name, ', ') as products
            FROM amazon_orders ao
            JOIN amazon_order_items aoi ON aoi.order_id = ao.id
            WHERE ao.matched_expense_id IN (${batchIds.map(() => '?').join(',')})
            GROUP BY ao.matched_expense_id`,
      args: batchIds,
    });
    for (const row of amazonResult.rows) {
      const r = row as unknown as { matched_expense_id: number; products: string };
      amazonMap.set(r.matched_expense_id, r.products);
    }
  }

  // 8. Build LLM payload and call
  const expensesForLlm = batch.map((e) => {
    const amazonProducts = amazonMap.get(e.id);
    return {
      id: e.id, date: e.date,
      description: amazonProducts ? `Amazon order: ${amazonProducts}` : e.description,
      amount_aud: e.amount_aud,
    };
  });

  const treeForLlm = categoryTree.map((cat) => ({
    id: cat.id, name: cat.name,
    children: cat.children.map((child) => ({ id: child.id, name: child.name })),
  }));

  const results = await categorizeBatch(expensesForLlm, treeForLlm, fewShotExamples, llmSettings);

  // 9. Save expense results
  for (const result of results) {
    await db.execute({
      sql: `INSERT INTO llm_suggestions (expense_id, suggested_category_id, suggested_subcategory_id, confidence, llm_reasoning, model_used, created_at)
            SELECT ?, ?, ?, ?, ?, ?, datetime('now')
            WHERE NOT EXISTS (SELECT 1 FROM llm_suggestions WHERE expense_id = ?)`,
      args: [result.expense_id, result.category_id, result.subcategory_id, result.confidence, result.reasoning, modelUsed, result.expense_id],
    });
    await db.execute({
      sql: `UPDATE expenses SET category_id = ?, subcategory_id = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [result.category_id, result.subcategory_id, result.expense_id],
    });
  }

  done += batch.length;
  const remaining = (remainingExpenses.length - batch.length) + (incomeToProcess.length - incomeBatch.length);

  return { done, total, remaining };
}

// ---------------------------------------------------------------------------
// updateMerchantRules — called when a batch is finalized
// ---------------------------------------------------------------------------

export async function updateMerchantRules(batchId: number): Promise<void> {
  // Fetch all approved, non-split, non-rule-matched expenses in this batch
  const result = await db.execute({
    sql: `SELECT e.* FROM expenses e
          WHERE e.batch_id = ?
            AND e.review_status = 'approved'
            AND e.split_parent_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM llm_suggestions ls WHERE ls.expense_id = e.id AND ls.confidence = 'rule')`,
    args: [batchId],
  });

  const expenses = result.rows as unknown as Expense[];

  for (const expense of expenses) {
    if (!expense.category_id) continue;

    const pattern = normalizeDescription(expense.description);
    if (!pattern) continue;

    // Upsert into merchant_rules
    await db.execute({
      sql: `INSERT INTO merchant_rules (description_pattern, category_id, subcategory_id, match_count, last_matched_at, created_at)
            VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
            ON CONFLICT(description_pattern) DO UPDATE SET
              category_id = excluded.category_id,
              subcategory_id = excluded.subcategory_id,
              match_count = match_count + 1,
              last_matched_at = datetime('now')`,
      args: [pattern, expense.category_id, expense.subcategory_id],
    });
  }
}
