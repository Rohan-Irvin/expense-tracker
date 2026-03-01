import OpenAI from 'openai';

export interface CategorizationResult {
  expense_id: number;
  category_id: number;
  subcategory_id: number | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export async function categorizeBatch(
  expenses: { id: number; date: string; description: string; amount_aud: number }[],
  categoryTree: { id: number; name: string; children: { id: number; name: string }[] }[],
  fewShotExamples: { description: string; category_name: string; subcategory_name: string | null }[],
  settings: { baseUrl: string; model: string }
): Promise<CategorizationResult[]> {
  // Note: errors from the API call are intentionally NOT caught here — they
  // propagate up so the SSE handler can report them to the frontend.
  const client = new OpenAI({
    baseURL: settings.baseUrl,
    apiKey: 'lm-studio',
    timeout: 30 * 60 * 1000, // 30 minutes — local models can be slow
    maxRetries: 0,            // Don't retry; let the SSE handler report the error
  });

  try {

    // Build the set of valid category IDs for validation
    const validCategoryIds = new Set<number>();
    for (const cat of categoryTree) {
      validCategoryIds.add(cat.id);
      for (const child of cat.children) {
        validCategoryIds.add(child.id);
      }
    }

    // Build system prompt
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

Return a JSON object with a "results" array containing one entry per expense.`;

    const userMessage = JSON.stringify(expenses);

    const response = await client.chat.completions.create({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.6,
      top_p: 0.95,
      response_format: {
        type: 'json_schema',
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
      } as any,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error('LLM returned empty content');
      return [];
    }

    let parsed: { results: CategorizationResult[] };
    try {
      parsed = JSON.parse(content) as { results: CategorizationResult[] };
    } catch {
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
        console.warn(
          `Skipping expense ${result.expense_id}: invalid category_id ${result.category_id}`
        );
        continue;
      }
      if (result.subcategory_id !== null && result.subcategory_id !== undefined && !validCategoryIds.has(result.subcategory_id)) {
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
  } catch (err: any) {
    // Re-throw connection/API errors so the SSE handler can report them to the
    // frontend. Only swallow JSON-parse errors (handled above).
    console.error('LLM API error:', err?.message ?? err);
    throw err;
  }
}
