import { useState, useEffect, useMemo, useRef } from 'react';
import { income } from '@/api/client';
import type { IncomeEntry } from '@/types';

// ---------- helpers ----------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amount: number, currency: string = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

// ---------- types for CSV import flow ----------

interface ParseResult {
  columns: string[];
  sampleRows: Record<string, string>[];
}

interface IncomeColumnMap {
  date: string;
  source: string;
  amount: string;
}

// ---------- component ----------

export default function Income() {
  // Income data
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Collapsible sections
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Add Income form state
  const [formDate, setFormDate] = useState(todayISO());
  const [formSource, setFormSource] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [formNote, setFormNote] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // CSV Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [columnMap, setColumnMap] = useState<IncomeColumnMap>({ date: '', source: '', amount: '' });
  const [importCurrency, setImportCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [confirming, setConfirming] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---------- load data ----------

  const loadEntries = async () => {
    try {
      const data = await income.list();
      setEntries(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load income entries.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, []);

  // ---------- summary calculations ----------

  const { monthTotal, yearTotal } = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let month = 0;
    let year = 0;

    for (const entry of entries) {
      const d = new Date(entry.date + 'T00:00:00');
      if (d.getFullYear() === currentYear) {
        year += entry.amount_aud;
        if (d.getMonth() === currentMonth) {
          month += entry.amount_aud;
        }
      }
    }

    return { monthTotal: month, yearTotal: year };
  }, [entries]);

  // ---------- add income handler ----------

  const handleSave = async () => {
    if (!formSource.trim()) {
      setFormMessage({ type: 'error', text: 'Source is required.' });
      return;
    }
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) {
      setFormMessage({ type: 'error', text: 'Please enter a valid positive amount.' });
      return;
    }

    setFormSaving(true);
    setFormMessage(null);
    try {
      await income.create({
        date: formDate,
        source: formSource.trim(),
        amount: amount,
        currency: formCurrency,
        note: formNote.trim() || null,
      });
      setFormMessage({ type: 'success', text: 'Income entry saved successfully.' });
      // Reset form
      setFormDate(todayISO());
      setFormSource('');
      setFormAmount('');
      setFormCurrency('AUD');
      setFormNote('');
      // Reload entries
      await loadEntries();
    } catch (err: any) {
      setFormMessage({ type: 'error', text: err.message || 'Failed to save income entry.' });
    } finally {
      setFormSaving(false);
    }
  };

  // ---------- CSV import handlers ----------

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);
    setParseResult(null);
    setImportMessage(null);
    setParsing(true);

    try {
      const result = await income.parse(file);
      setParseResult(result);
      // Auto-set column map if columns look obvious
      const cols: string[] = result.columns;
      setColumnMap({
        date: cols.find((c: string) => /date/i.test(c)) || '',
        source: cols.find((c: string) => /source|desc|payee|from|name/i.test(c)) || '',
        amount: cols.find((c: string) => /amount|total|sum|value/i.test(c)) || '',
      });
    } catch (err: any) {
      setImportMessage({ type: 'error', text: err.message || 'Failed to parse CSV file.' });
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!csvFile) return;
    if (!columnMap.date || !columnMap.source || !columnMap.amount) {
      setImportMessage({ type: 'error', text: 'Please map all required columns (date, source, amount).' });
      return;
    }

    setConfirming(true);
    setImportMessage(null);

    try {
      const result = await income.confirm(csvFile, columnMap, importCurrency);
      const count = result.count ?? result.imported ?? 0;
      setImportMessage({ type: 'success', text: `Successfully imported ${count} income entries.` });
      // Reset import state
      setCsvFile(null);
      setParseResult(null);
      setColumnMap({ date: '', source: '', amount: '' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Reload entries
      await loadEntries();
    } catch (err: any) {
      setImportMessage({ type: 'error', text: err.message || 'Failed to import CSV.' });
    } finally {
      setConfirming(false);
    }
  };

  const handleResetImport = () => {
    setCsvFile(null);
    setParseResult(null);
    setColumnMap({ date: '', source: '', amount: '' });
    setImportMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---------- render ----------

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Income</h1>
        <p className="text-muted-foreground mt-4">Loading income data...</p>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Income</h1>
        <p className="text-destructive mt-4">{error}</p>
        <button
          onClick={() => { setLoading(true); loadEntries(); }}
          className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <h1 className="text-2xl font-bold">Income</h1>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          onClick={() => { setShowAddForm(!showAddForm); setShowImport(false); }}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            showAddForm
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          {showAddForm ? 'Close Form' : 'Add Income'}
        </button>
        <button
          onClick={() => { setShowImport(!showImport); setShowAddForm(false); }}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            showImport
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}
        >
          {showImport ? 'Close Import' : 'Import CSV'}
        </button>
      </div>

      {/* Add Income Form */}
      {showAddForm && (
        <div className="bg-card border rounded-lg p-4 mt-4 max-w-lg space-y-4">
          <h2 className="text-lg font-semibold">Add Income</h2>

          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Source</label>
            <input
              type="text"
              value={formSource}
              onChange={(e) => setFormSource(e.target.value)}
              placeholder="e.g. Employer, Freelance, Dividends"
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <input
                type="number"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                value={formCurrency}
                onChange={(e) => setFormCurrency(e.target.value as 'AUD' | 'USD')}
                className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="AUD">AUD</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Note (optional)</label>
            <textarea
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Any additional details..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={formSaving}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {formSaving ? 'Saving...' : 'Save'}
          </button>

          {formMessage && (
            <p className={`text-sm ${formMessage.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>
              {formMessage.text}
            </p>
          )}
        </div>
      )}

      {/* CSV Import Section */}
      {showImport && (
        <div className="bg-card border rounded-lg p-4 mt-4 max-w-2xl space-y-4">
          <h2 className="text-lg font-semibold">Import CSV</h2>

          {/* File input */}
          <div>
            <label className="block text-sm font-medium mb-1">CSV File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80"
            />
          </div>

          {parsing && (
            <p className="text-sm text-muted-foreground">Parsing CSV file...</p>
          )}

          {/* Column mapping */}
          {parseResult && (
            <>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Map Columns</h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-muted-foreground">Date Column</label>
                    <select
                      value={columnMap.date}
                      onChange={(e) => setColumnMap((prev) => ({ ...prev, date: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">-- Select --</option>
                      {parseResult.columns.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-muted-foreground">Source / Description</label>
                    <select
                      value={columnMap.source}
                      onChange={(e) => setColumnMap((prev) => ({ ...prev, source: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">-- Select --</option>
                      {parseResult.columns.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-muted-foreground">Amount Column</label>
                    <select
                      value={columnMap.amount}
                      onChange={(e) => setColumnMap((prev) => ({ ...prev, amount: e.target.value }))}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">-- Select --</option>
                      {parseResult.columns.map((col) => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="max-w-xs">
                  <label className="block text-xs font-medium mb-1 text-muted-foreground">Currency</label>
                  <select
                    value={importCurrency}
                    onChange={(e) => setImportCurrency(e.target.value as 'AUD' | 'USD')}
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="AUD">AUD</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              {/* Sample data preview */}
              {parseResult.sampleRows.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Sample Data</h3>
                  <div className="overflow-x-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted">
                          {parseResult.columns.map((col) => (
                            <th key={col} className="text-left py-2 px-3 font-medium text-xs">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parseResult.sampleRows.slice(0, 3).map((row, idx) => (
                          <tr key={idx} className="border-t">
                            {parseResult.columns.map((col) => (
                              <td key={col} className="py-2 px-3 text-xs">
                                {row[col] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Confirm / Reset buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleConfirmImport}
                  disabled={confirming}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {confirming ? 'Importing...' : 'Confirm Import'}
                </button>
                <button
                  onClick={handleResetImport}
                  disabled={confirming}
                  className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
            </>
          )}

          {importMessage && (
            <p className={`text-sm ${importMessage.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>
              {importMessage.text}
            </p>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Income This Month</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(monthTotal)}</p>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground">Income This Year</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(yearTotal)}</p>
        </div>
      </div>

      {/* Income table */}
      <div className="mt-6 overflow-x-auto">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No income entries yet. Add one manually or import from CSV.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium">Date</th>
                <th className="text-left py-3 px-4 font-medium">Source</th>
                <th className="text-right py-3 px-4 font-medium">Amount (AUD)</th>
                <th className="text-right py-3 px-4 font-medium">Original Amount</th>
                <th className="text-left py-3 px-4 font-medium">Type</th>
                <th className="text-left py-3 px-4 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b hover:bg-muted/50">
                  <td className="py-3 px-4 whitespace-nowrap">{formatDate(entry.date)}</td>
                  <td className="py-3 px-4">{entry.source}</td>
                  <td className="py-3 px-4 text-right font-medium whitespace-nowrap">
                    {formatCurrency(entry.amount_aud)}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap text-muted-foreground">
                    {entry.currency_original === 'USD'
                      ? formatCurrency(entry.amount_original, 'USD')
                      : '\u2014'}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        entry.entry_type === 'manual'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                          : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      }`}
                    >
                      {entry.entry_type === 'manual' ? 'Manual' : 'CSV Import'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground">
                    {entry.note || '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
