import { useState, useEffect } from 'react';
import { settings } from '@/api/client';
import type { AppSettings } from '@/types';

const OPENAI_MODELS = [
  { value: 'gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
  { value: 'gpt-4o', label: 'GPT-4o (best quality)' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (cheapest)' },
  { value: 'gpt-5-mini', label: 'GPT-5 mini' },
  { value: 'gpt-5-nano', label: 'GPT-5 nano' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 nano (fastest, cheapest)' },
];

const defaultForm: AppSettings = {
  lm_studio_base_url: '',
  lm_studio_model: '',
  lm_studio_context_length: '20000',
  default_currency: 'AUD',
  llm_batch_size: '10',
  llm_provider: 'local',
  openai_api_key: '',
  openai_model: 'gpt-4o-mini',
};

export default function Settings() {
  const [form, setForm] = useState<AppSettings>(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [prefsMessage, setPrefsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    settings.get().then((data) => {
      setForm({
        lm_studio_base_url: data.lm_studio_base_url || '',
        lm_studio_model: data.lm_studio_model || '',
        lm_studio_context_length: data.lm_studio_context_length || '20000',
        default_currency: data.default_currency || 'AUD',
        llm_batch_size: data.llm_batch_size || '10',
        llm_provider: data.llm_provider || 'local',
        openai_api_key: data.openai_api_key || '',
        openai_model: data.openai_model || 'gpt-4o-mini',
      });
    }).catch(() => {
      setStatusMessage({ type: 'error', text: 'Failed to load settings.' });
    }).finally(() => setLoading(false));
  }, []);

  const handleChange = (field: keyof AppSettings, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleProviderToggle = (provider: 'local' | 'openai') => {
    setForm((prev) => ({ ...prev, llm_provider: provider }));
    setStatusMessage(null);
  };

  const handleSaveLlm = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      await settings.update({
        llm_provider: form.llm_provider,
        lm_studio_base_url: form.lm_studio_base_url,
        lm_studio_model: form.lm_studio_model,
        lm_studio_context_length: form.lm_studio_context_length,
        llm_batch_size: form.llm_batch_size,
        openai_api_key: form.openai_api_key,
        openai_model: form.openai_model,
      });
      setStatusMessage({ type: 'success', text: 'LLM settings saved successfully.' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setStatusMessage(null);
    // Save first so the server tests the current form values
    try {
      await settings.update({
        llm_provider: form.llm_provider,
        lm_studio_base_url: form.lm_studio_base_url,
        lm_studio_model: form.lm_studio_model,
        lm_studio_context_length: form.lm_studio_context_length,
        openai_api_key: form.openai_api_key,
        openai_model: form.openai_model,
      });
    } catch {
      // ignore save errors — still try the test
    }
    try {
      const result = await settings.testLlm();
      if (result.ok) {
        setStatusMessage({ type: 'success', text: `Connection successful! Model: ${result.model}` });
      } else {
        setStatusMessage({ type: 'error', text: result.error || 'Connection test failed.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSavePrefs = async () => {
    setSavingPrefs(true);
    setPrefsMessage(null);
    try {
      await settings.update({ default_currency: form.default_currency });
      setPrefsMessage({ type: 'success', text: 'Preferences saved successfully.' });
    } catch (err: any) {
      setPrefsMessage({ type: 'error', text: err.message || 'Failed to save preferences.' });
    } finally {
      setSavingPrefs(false);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground mt-4">Loading settings...</p>
      </div>
    );
  }

  const isLocal = form.llm_provider !== 'openai';
  const isOpenAI = form.llm_provider === 'openai';

  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="max-w-xl space-y-6 mt-6">

        {/* LLM Configuration */}
        <div className="bg-card border rounded-lg p-6 space-y-5">
          <h2 className="text-lg font-semibold">LLM Configuration</h2>

          {/* Provider toggle */}
          <div>
            <label className="block text-sm font-medium mb-2">Provider</label>
            <div className="flex rounded-md border border-input overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => handleProviderToggle('local')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  isLocal
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                Local LLM
              </button>
              <button
                type="button"
                onClick={() => handleProviderToggle('openai')}
                className={`px-4 py-2 text-sm font-medium border-l border-input transition-colors ${
                  isOpenAI
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                OpenAI API
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {isLocal
                ? 'Use a locally running model via LM Studio (private, no API costs).'
                : 'Use OpenAI\'s cloud API (requires an API key, usage is billed).'}
            </p>
          </div>

          {/* ---- Local LLM (LM Studio) fields ---- */}
          {isLocal && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Base URL</label>
                <input
                  type="text"
                  value={form.lm_studio_base_url}
                  onChange={(e) => handleChange('lm_studio_base_url', e.target.value)}
                  placeholder="http://localhost:1234/v1"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Model Name</label>
                <input
                  type="text"
                  value={form.lm_studio_model}
                  onChange={(e) => handleChange('lm_studio_model', e.target.value)}
                  placeholder="e.g. qwen2.5-7b-instruct"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Must match the model name shown in LM Studio.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Context Length</label>
                <input
                  type="number"
                  value={form.lm_studio_context_length}
                  onChange={(e) => handleChange('lm_studio_context_length', e.target.value)}
                  min="1000"
                  step="1000"
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Maximum tokens the model can process (prompt + response). Sent as <code>context_length</code> to LM Studio.
                </p>
              </div>
            </>
          )}

          {/* ---- OpenAI fields ---- */}
          {isOpenAI && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">API Key</label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={form.openai_api_key}
                    onChange={(e) => handleChange('openai_api_key', e.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                    className="w-full px-3 py-2 pr-20 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Your key is stored locally in the app database and never sent anywhere except OpenAI.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Model</label>
                <select
                  value={form.openai_model}
                  onChange={(e) => handleChange('openai_model', e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {OPENAI_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  GPT-4o mini offers the best balance of accuracy and cost for categorization.
                </p>
              </div>
            </>
          )}

          {/* Batch size — applies to both providers */}
          <div>
            <label className="block text-sm font-medium mb-1">Batch Size</label>
            <input
              type="number"
              value={form.llm_batch_size}
              onChange={(e) => handleChange('llm_batch_size', e.target.value)}
              min="1"
              max="50"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {isOpenAI
                ? 'Number of expenses sent to OpenAI per API call (1–50). Higher values are more efficient.'
                : 'Number of expenses sent to the local model per call. Reduce if you hit context-length errors.'}
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSaveLlm}
              disabled={saving || testing}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={handleTestConnection}
              disabled={saving || testing}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
          </div>

          {statusMessage && (
            <p className={`text-sm ${statusMessage.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>
              {statusMessage.text}
            </p>
          )}
        </div>

        {/* Preferences */}
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">Preferences</h2>

          <div>
            <label className="block text-sm font-medium mb-1">Default Currency</label>
            <select
              value={form.default_currency}
              onChange={(e) => handleChange('default_currency', e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="AUD">AUD</option>
              <option value="USD">USD</option>
            </select>
          </div>

          <button
            onClick={handleSavePrefs}
            disabled={savingPrefs}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {savingPrefs ? 'Saving...' : 'Save Preferences'}
          </button>

          {prefsMessage && (
            <p className={`text-sm ${prefsMessage.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>
              {prefsMessage.text}
            </p>
          )}
        </div>

      </div>
    </div>
  );
}
