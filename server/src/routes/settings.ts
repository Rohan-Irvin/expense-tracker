import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import db from '../db/connection.js';

const router = Router();

// Helper: query all settings and return as a key-value object
async function getAllSettings(): Promise<Record<string, string>> {
  const result = await db.execute('SELECT key, value FROM app_settings');
  const settings: Record<string, string> = {};
  for (const row of result.rows) {
    const r = row as unknown as { key: string; value: string };
    settings[r.key] = r.value;
  }
  return settings;
}

// GET /api/settings — return all settings as a JSON object
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PATCH /api/settings — update settings
router.patch('/', async (req: Request, res: Response) => {
  try {
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    for (const [key, value] of Object.entries(updates)) {
      await db.execute({
        sql: `INSERT INTO app_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, String(value)],
      });
    }

    const settings = await getAllSettings();
    res.json(settings);
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// POST /api/settings/test-llm — test LLM connection (provider-aware)
router.post('/test-llm', async (_req: Request, res: Response) => {
  try {
    const settings = await getAllSettings();
    const provider = settings.llm_provider === 'openai' ? 'openai' : 'local';

    if (provider === 'openai') {
      // ----- Test OpenAI -----
      const apiKey = settings.openai_api_key;
      const modelName = settings.openai_model || 'gpt-4o-mini';

      if (!apiKey) {
        return res.status(400).json({ ok: false, error: 'OpenAI API key is not configured. Add your key in Settings.' });
      }

      const client = new OpenAI({
        apiKey,
        timeout: 30_000,
        maxRetries: 0,
      });

      const response = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 10,
      });

      res.json({ ok: true, model: response.model, provider: 'openai' });
    } else {
      // ----- Test Local LLM (LM Studio) -----
      const baseUrl = settings.lm_studio_base_url;
      const modelName = settings.lm_studio_model;

      if (!baseUrl) {
        return res.status(400).json({ ok: false, error: 'LM Studio base URL is not configured' });
      }
      if (!modelName) {
        return res.status(400).json({ ok: false, error: 'LM Studio model is not configured' });
      }

      const contextLength = parseInt(settings.lm_studio_context_length || '0', 10);
      const client = new OpenAI({ baseURL: baseUrl, apiKey: 'lm-studio' });
      const response = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: 'Say hello' }],
        max_tokens: 10,
        ...(contextLength ? { context_length: contextLength } : {}),
      } as any);

      res.json({ ok: true, model: response.model, provider: 'local' });
    }
  } catch (err: any) {
    console.error('LLM connection test failed:', err);
    // Surface friendly OpenAI-specific messages
    const msg: string = err?.message || 'Connection failed';
    if (msg.includes('401') || msg.includes('Incorrect API key') || msg.includes('invalid_api_key')) {
      return res.json({ ok: false, error: 'Invalid OpenAI API key. Check your key in Settings.' });
    }
    if (msg.includes('insufficient_quota')) {
      return res.json({ ok: false, error: 'OpenAI quota exceeded. Check your account billing.' });
    }
    res.json({ ok: false, error: msg });
  }
});

export default router;
