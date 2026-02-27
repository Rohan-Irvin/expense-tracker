import { useState, useEffect } from 'react';
import { settings } from '@/api/client';
import type { AppSettings } from '@/types';

export default function Settings() {
  const [form, setForm] = useState<AppSettings>({
    lm_studio_base_url: '',
    lm_studio_model: '',
    default_currency: 'AUD',
    llm_batch_size: '10',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [prefsMessage, setPrefsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    settings.get().then((data) => {
      setForm({
        lm_studio_base_url: data.lm_studio_base_url || '',
        lm_studio_model: data.lm_studio_model || '',
        default_currency: data.default_currency || 'AUD',
        llm_batch_size: data.llm_batch_size || '10',
      });
    }).catch(() => {
      setStatusMessage({ type: 'error', text: 'Failed to load settings.' });
    }).finally(() => setLoading(false));
  }, []);

  const handleChange = (field: keyof AppSettings, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveLlm = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      await settings.update({
        lm_studio_base_url: form.lm_studio_base_url,
        lm_studio_model: form.lm_studio_model,
        llm_batch_size: form.llm_batch_size,
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

  return (
    <div>
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="max-w-xl space-y-6 mt-6">
        {/* LM Studio Configuration */}
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">LM Studio Configuration</h2>

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
          </div>

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
          </div>

          <div className="flex gap-2">
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
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            >
              {testing ? 'Testing...' : 'Test LLM Connection'}
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
