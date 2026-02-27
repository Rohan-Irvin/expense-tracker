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

// POST /api/settings/test-llm — test LM Studio connection
router.post('/test-llm', async (_req: Request, res: Response) => {
  try {
    const settings = await getAllSettings();
    const baseUrl = settings.lm_studio_base_url;
    const modelName = settings.lm_studio_model;

    if (!baseUrl) {
      return res.status(400).json({ ok: false, error: 'LM Studio base URL is not configured' });
    }

    if (!modelName) {
      return res.status(400).json({ ok: false, error: 'LM Studio model is not configured' });
    }

    const client = new OpenAI({ baseURL: baseUrl, apiKey: 'lm-studio' });
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: 'Say hello' }],
      max_tokens: 10,
    });

    res.json({ ok: true, model: response.model });
  } catch (err: any) {
    console.error('LLM connection test failed:', err);
    res.json({ ok: false, error: err.message || 'Connection failed' });
  }
});

export default router;
