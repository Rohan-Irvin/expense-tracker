import OpenAI from 'openai';

export interface CategorizationResult {
  expense_id: number;
  category_id: number;
  subcategory_id: number | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML tags and return a clean, short error message. */
function cleanLlmError(err: any): string {
  const raw: string = err?.message || String(err) || 'Unknown LLM error';

  // Connection refused → actionable message
  if (
    err?.cause?.code === 'ECONNREFUSED' ||
    err?.code === 'ECONNREFUSED' ||
    raw.includes('ECONNREFUSED')
  ) {
    return 'Cannot connect to LM Studio. Make sure LM Studio is running with the local server enabled.';
  }

  // HTML body in error (LM Studio returned an error page) → actionable message
  if (raw.includes('<!DOCTYPE') || raw.includes('<html') || raw.includes('<HTML')) {
    return (
      'LM Studio returned an error page instead of a valid response. ' +
      'Make sure your model is fully loaded in LM Studio, then try again. ' +
      'You can verify with Settings → Test LLM Connection.'
    );
  }

  return raw;
}

/** Parse a JSON result array out of an LLM text response (handles markdown code fences). */
function parseJsonFromText(text: string): { results: CategorizationResult[] } | null {
  // Strip markdown code fences if present
  let cleaned = text.trim();
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
  settings: { baseUrl: string; model: string }
): Promise<CategorizationResult[]> {
  const client = new OpenAI({
    baseURL: settings.baseUrl,
    apiKey: 'lm-studio',
    timeout: 30 * 60 * 1000, // 30 minutes — local models can be slow
    maxRetries: 0,
  });

  // Build the set of valid category IDs for validation
  const validCategoryIds = new Set<number>();
  for (const cat of categoryTree) {
    validCategoryIds.add(cat.id);
    for (const child of cat.children) {
      validCategoryIds.add(child.id);
    }
  }

  // Build prompts
  const categoryTreeJson = JSON.stringify(categoryTree, null, 2);

  let fewShotSection = '';
  if (fewShotExamples.length > 0) {
    const exampleLines = fewShotExamples.map((ex) => {
      const sub = ex.subcategory_name ? ` > ${ex.subcategory_name}` : '';
      return `"${ex.description}" → ${ex.category_name}${sub}`;
    });
    fewShotSection = `\n\nHere are examples of previously categorized expenses:\n${exampleLines.join('\n')}`;
  }

  const systemPrompt = `You are an expense categorization assistant. Given a list of expense transactions, assign each one to the most appropriate category and optionally a subcategory from the provided category tree.

Category tree:
${categoryTreeJson}
${fewShotSection}

For each expense, return:
- expense_id: the id of the expense
- category_id: the id of the best matching top-level category
- subcategory_id: the id of the best matching subcategory (or null if none fits)
- confidence: "high", "medium", or "low" based on how certain you are
- reasoning: a brief explanation of why you chose this category

Return ONLY a valid JSON object with a "results" array containing one entry per expense. No explanation, no markdown, just the JSON object.`;

  const userMessage = JSON.stringify(expenses);

  const jsonSchema = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'categorization',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                expense_id: { type: 'integer' },
                category_id: { type: 'integer' },
                subcategory_id: { type: ['integer', 'null'] },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                reasoning: { type: 'string' },
              },
              required: ['expense_id', 'category_id', 'subcategory_id', 'confidence', 'reasoning'],
              additionalProperties: false,
            },
          },
        },
        required: ['results'],
        additionalProperties: false,
      },
    },
  };

  let content: string | null = null;

  // --- Attempt 1: try with json_schema (constrained decoding) ---
  try {
    const response = await client.chat.completions.create({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.6,
      top_p: 0.95,
      response_format: jsonSchema as any,
    });
    content = response.choices[0]?.message?.content ?? null;
  } catch (err: any) {
    // Re-throw immediately for connection errors — no point retrying
    if (
      err?.cause?.code === 'ECONNREFUSED' ||
      err?.code === 'ECONNREFUSED' ||
      (err?.message || '').includes('ECONNREFUSED')
    ) {
      throw new Error(cleanLlmError(err));
    }

    // For other API errors (json_schema unsupported, model error, etc.)
    // fall through to Attempt 2 (plain text) instead of giving up.
    console.warn(
      '[llm] json_schema attempt failed, falling back to plain text:',
      cleanLlmError(err).slice(0, 120)
    );
  }

  // --- Attempt 2: plain text (no response_format) ---
  if (content === null) {
    try {
      const response = await client.chat.completions.create({
        model: settings.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.6,
        top_p: 0.95,
        // No response_format — rely on the prompt instruction to return JSON
      });
      content = response.choices[0]?.message?.content ?? null;
    } catch (err: any) {
      // Both attempts failed — throw a clean error
      throw new Error(cleanLlmError(err));
    }
  }

  if (!content) {
    console.error('LLM returned empty content');
    return [];
  }

  // Parse JSON from the response
  const parsed = parseJsonFromText(content);
  if (!parsed) {
    console.error('LLM returned non-JSON content:', content.slice(0, 200));
    return [];
  }

  if (!Array.isArray(parsed.results)) {
    console.error('LLM response missing results array:', content.slice(0, 200));
    return [];
  }

  // Validate each result — only keep entries with valid category IDs
  const validated: CategorizationResult[] = [];
  for (const result of parsed.results) {
    if (!validCategoryIds.has(result.category_id)) {
      console.warn(`Skipping expense ${result.expense_id}: invalid category_id ${result.category_id}`);
      continue;
    }
    if (
      result.subcategory_id !== null &&
      result.subcategory_id !== undefined &&
      !validCategoryIds.has(result.subcategory_id)
    ) {
      console.warn(
        `Skipping expense ${result.expense_id}: invalid subcategory_id ${result.subcategory_id}`
      );
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

  return validated;
}
