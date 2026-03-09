import OpenAI from 'openai';

export interface CategorizationResult {
  expense_id: number;
  category_id: number;
  subcategory_id: number | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export type LlmProvider = 'local' | 'openai';

export interface LlmSettings {
  provider: LlmProvider;
  // Local LLM (LM Studio) settings
  baseUrl: string;
  model: string;
  contextLength?: number;
  // OpenAI settings
  apiKey?: string;
  openaiModel?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a clean, user-friendly error message from an LLM API error. */
function cleanLlmError(err: any, provider: LlmProvider): string {
  const raw: string = err?.message || String(err) || 'Unknown LLM error';

  if (
    err?.cause?.code === 'ECONNREFUSED' ||
    err?.code === 'ECONNREFUSED' ||
    raw.includes('ECONNREFUSED')
  ) {
    if (provider === 'local') {
      return 'Cannot connect to LM Studio. Make sure LM Studio is running with the local server enabled.';
    }
    return 'Cannot connect to the LLM service. Check your network connection.';
  }

  if (raw.includes('<!DOCTYPE') || raw.includes('<html') || raw.includes('<HTML')) {
    return (
      'LM Studio returned an error page instead of a valid response. ' +
      'Make sure your model is fully loaded in LM Studio, then try again. ' +
      'You can verify with Settings → Test LLM Connection.'
    );
  }

  // OpenAI-specific errors
  if (provider === 'openai') {
    if (raw.includes('401') || raw.includes('Incorrect API key') || raw.includes('invalid_api_key')) {
      return 'Invalid OpenAI API key. Check your key in Settings.';
    }
    if (raw.includes('429') || raw.includes('rate_limit')) {
      return 'OpenAI rate limit reached. Wait a moment and try again.';
    }
    if (raw.includes('insufficient_quota')) {
      return 'OpenAI quota exceeded. Check your OpenAI account billing.';
    }
  }

  return raw;
}

/**
 * Parse the JSON results array out of an LLM text response.
 * Handles:
 *  - Markdown code fences (```json ... ```)
 *  - <think>...</think> blocks (Qwen3 reasoning traces)
 *  - Leading/trailing prose around the JSON object
 */
function parseJsonFromText(text: string): { results: CategorizationResult[] } | null {
  let cleaned = text.trim();

  // Strip <think>...</think> reasoning blocks (Qwen3 models)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Find the outermost JSON object
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { results: CategorizationResult[] };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function categorizeBatch(
  expenses: { id: number; date: string; description: string; amount_aud: number }[],
  categoryTree: { id: number; name: string; children: { id: number; name: string }[] }[],
  fewShotExamples: { description: string; category_name: string; subcategory_name: string | null }[],
  settings: LlmSettings
): Promise<CategorizationResult[]> {
  const provider = settings.provider ?? 'local';
  const isOpenAI = provider === 'openai';

  // Determine actual API endpoint and key based on provider
  const baseURL = isOpenAI ? 'https://api.openai.com/v1' : settings.baseUrl;
  const apiKey = isOpenAI ? (settings.apiKey || '') : 'lm-studio';
  const modelName = isOpenAI ? (settings.openaiModel || 'gpt-4o-mini') : settings.model;

  const client = new OpenAI({
    baseURL,
    apiKey,
    timeout: 5 * 60 * 1000, // 5 minutes
    maxRetries: isOpenAI ? 2 : 0, // OpenAI is reliable; LM Studio retries cause hangs
  });

  // Build the set of valid category IDs for response validation
  const validCategoryIds = new Set<number>();
  for (const cat of categoryTree) {
    validCategoryIds.add(cat.id);
    for (const child of cat.children) {
      validCategoryIds.add(child.id);
    }
  }

  // Compact flat text category list — far fewer tokens than raw JSON
  const categoryList = categoryTree
    .map((cat) => {
      const subs = cat.children.length
        ? ` (subcategories: ${cat.children.map((c) => `${c.name}[id:${c.id}]`).join(', ')})`
        : '';
      return `[id:${cat.id}] ${cat.name}${subs}`;
    })
    .join('\n');

  let fewShotSection = '';
  if (fewShotExamples.length > 0) {
    const lines = fewShotExamples.map((ex) => {
      const sub = ex.subcategory_name ? ` > ${ex.subcategory_name}` : '';
      return `"${ex.description}" → ${ex.category_name}${sub}`;
    });
    fewShotSection = `\nExamples:\n${lines.join('\n')}`;
  }

  // No response_format / json_schema — grammar-constrained decoding causes
  // LM Studio to hang indefinitely on some models. Plain text + a clear
  // prompt instruction is more reliable.
  const systemPrompt = `Categorize expenses. For each, pick the best category (and subcategory if applicable) from the list below. Return ONLY a JSON object with a "results" array — no explanation, no markdown.

Categories:
${categoryList}
${fewShotSection}

JSON format for each result: {"expense_id":<int>,"category_id":<int>,"subcategory_id":<int|null>,"confidence":"high"|"medium"|"low","reasoning":"<brief>"}`;

  const userMessage = JSON.stringify(expenses);

  let content: string | null = null;

  // Build completion params — context_length is an LM Studio extension ignored by real OpenAI
  const completionParams: any = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.6,
    top_p: 0.95,
  };

  if (!isOpenAI && settings.contextLength) {
    completionParams.context_length = settings.contextLength;
  }

  try {
    const response = await client.chat.completions.create(completionParams);
    content = response.choices[0]?.message?.content ?? null;
  } catch (err: any) {
    throw new Error(cleanLlmError(err, provider));
  }

  if (!content) {
    console.error('[llm] LLM returned empty content');
    return [];
  }

  console.log('[llm] Raw response length:', content.length, 'chars');

  const parsed = parseJsonFromText(content);
  if (!parsed) {
    console.error('[llm] Failed to parse JSON from response:', content.slice(0, 300));
    return [];
  }

  if (!Array.isArray(parsed.results)) {
    console.error('[llm] Response missing results array:', content.slice(0, 300));
    return [];
  }

  // Validate — only keep results with IDs that exist in the category tree
  const validated: CategorizationResult[] = [];
  for (const result of parsed.results) {
    if (!validCategoryIds.has(result.category_id)) {
      console.warn(`[llm] Skipping expense ${result.expense_id}: invalid category_id ${result.category_id}`);
      continue;
    }
    if (
      result.subcategory_id !== null &&
      result.subcategory_id !== undefined &&
      !validCategoryIds.has(result.subcategory_id)
    ) {
      console.warn(`[llm] Skipping expense ${result.expense_id}: invalid subcategory_id ${result.subcategory_id}`);
      continue;
    }
    validated.push({
      expense_id: result.expense_id,
      category_id: result.category_id,
      subcategory_id: result.subcategory_id ?? null,
      confidence: result.confidence,
      reasoning: result.reasoning,
    });
  }

  console.log(`[llm] Validated ${validated.length}/${parsed.results.length} results`);
  return validated;
}
