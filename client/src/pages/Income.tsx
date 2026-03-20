import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Pencil, Trash2, Check, X, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { income, incomeCategories as incomeCatsApi } from '@/api/client';
import type { IncomeEntry } from '@/types';

// ---------- helpers ----------

interface IncomeCategory { id: number; name: string; created_at: string; }

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  return { from: `${y}-01-01`, to: todayISO() };
}

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amount: number, currency: string = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

type IncomeSortKey = 'date' | 'source' | 'category' | 'amount_aud' | 'amount_original' | 'entry_type';

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
  // Date filter
  const defaults = getDefaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo,   setDateTo]   = useState(defaults.to);

  // Income data
  const [entries, setEntries] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Income-specific categories (separate from expense categories)
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([]);
  const [showManageCats, setShowManageCats] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [addCatError, setAddCatError] = useState('');
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [renamingCat, setRenamingCat] = useState(false);
  const [deletingCatId, setDeletingCatId] = useState<number | null>(null);

  // Collapsible sections
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  // Add Income form state
  const [formDate, setFormDate] = useState(todayISO());
  const [formSource, setFormSource] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [formNote, setFormNote] = useState('');
  const [formCategoryId, setFormCategoryId] = useState<number>(0);
  const [formSaving, setFormSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Multi-select / bulk actions state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Bulk category assignment
  const [bulkCatId, setBulkCatId] = useState<number>(0);
  const [bulkCatAssigning, setBulkCatAssigning] = useState(false);

  // Table sort state
  const [sortKey, setSortKey] = useState<IncomeSortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Edit / delete state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCurrency, setEditCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [editNote, setEditNote] = useState('');
  const [editCategoryId, setEditCategoryId] = useState<number>(0);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // CSV Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [columnMap, setColumnMap] = useState<IncomeColumnMap>({ date: '', source: '', amount: '' });
  const [importCurrency, setImportCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [importDateFormat, setImportDateFormat] = useState<'DMY' | 'MDY' | 'ISO'>('DMY');
  const [confirming, setConfirming] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ---------- load data ----------

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = nextDay(dateTo);
      const data = await income.list(params);
      setEntries(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load income entries.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadCategories = async () => {
    try {
      const cats = await incomeCatsApi.list();
      setIncomeCategories(cats as IncomeCategory[]);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    loadCategories();
  }, []);

  // ---------- summary calculations ----------

  const periodTotal = useMemo(
    () => entries.reduce((sum, e) => sum + e.amount_aud, 0),
    [entries]
  );

  // ---------- income category handlers ----------

  const handleAddCat = async () => {
    if (!newCatName.trim()) return;
    setAddingCat(true);
    setAddCatError('');
    try {
      await incomeCatsApi.create(newCatName.trim());
      setNewCatName('');
      await loadCategories();
    } catch (err: any) {
      setAddCatError(err.message || 'Failed to create category.');
    } finally {
      setAddingCat(false);
    }
  };

  const handleRenameCat = async (id: number) => {
    if (!editCatName.trim()) return;
    setRenamingCat(true);
    try {
      await incomeCatsApi.rename(id, editCatName.trim());
      setEditingCatId(null);
      setEditCatName('');
      await loadCategories();
    } catch (err: any) {
      alert(err.message || 'Failed to rename category.');
    } finally {
      setRenamingCat(false);
    }
  };

  const handleDeleteCat = async (id: number) => {
    if (deletingCatId !== id) { setDeletingCatId(id); return; }
    try {
      await incomeCatsApi.delete(id);
      setDeletingCatId(null);
      await loadCategories();
    } catch (err: any) {
      alert(err.message || 'Failed to delete category.');
      setDeletingCatId(null);
    }
  };

  // ---------- add income handler ----------

  const handleSave = async () => {
    if (!formSource.trim()) { setFormMessage({ type: 'error', text: 'Source is required.' }); return; }
    const amount = parseFloat(formAmount);
    if (isNaN(amount) || amount <= 0) { setFormMessage({ type: 'error', text: 'Please enter a valid positive amount.' }); return; }

    setFormSaving(true);
    setFormMessage(null);
    try {
      await income.create({
        date: formDate,
        source: formSource.trim(),
        amount_original: amount,
        currency_original: formCurrency,
        note: formNote.trim() || null,
        income_category_id: formCategoryId || null,
      });
      setFormMessage({ type: 'success', text: 'Income entry saved successfully.' });
      setFormDate(todayISO());
      setFormSource('');
      setFormAmount('');
      setFormCurrency('AUD');
      setFormNote('');
      setFormCategoryId(0);
      await loadEntries();
    } catch (err: any) {
      setFormMessage({ type: 'error', text: err.message || 'Failed to save income entry.' });
    } finally {
      setFormSaving(false);
    }
  };

  // ---------- edit / delete handlers ----------

  const startEdit = (entry: IncomeEntry) => {
    setEditingId(entry.id);
    setEditDate(entry.date);
    setEditSource(entry.source);
    setEditAmount(String(entry.amount_original));
    setEditCurrency(entry.currency_original as 'AUD' | 'USD');
    setEditNote(entry.note ?? '');
    setEditCategoryId((entry as any).income_category_id ?? 0);
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleUpdate = async (id: number) => {
    const amount = parseFloat(editAmount);
    if (!editSource.trim() || isNaN(amount) || amount <= 0) return;
    setEditSaving(true);
    try {
      await income.update(id, {
        date: editDate,
        source: editSource.trim(),
        amount_original: amount,
        currency_original: editCurrency,
        note: editNote.trim() || null,
        income_category_id: editCategoryId || null,
      });
      setEditingId(null);
      await loadEntries();
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (deletingId !== id) { setDeletingId(id); return; }
    try {
      await income.delete(id);
      setDeletingId(null);
      await loadEntries();
    } catch {
      setDeletingId(null);
      await loadEntries();
    }
  };

  // ---------- multi-select helpers ----------

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: number[]) => setSelectedIds(new Set(ids)), []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkDelete = async () => {
    if (!confirmBulkDelete) { setConfirmBulkDelete(true); return; }
    setBulkDeleting(true);
    setConfirmBulkDelete(false);
    try {
      await Promise.all([...selectedIds].map((id) => income.delete(id)));
      setSelectedIds(new Set());
      await loadEntries();
    } catch {
      await loadEntries();
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleBulkAssignCategory = async () => {
    setBulkCatAssigning(true);
    try {
      await income.bulkUpdateCategory([...selectedIds], bulkCatId || null);
      setSelectedIds(new Set());
      setBulkCatId(0);
      await loadEntries();
    } catch (err: any) {
      alert(err.message || 'Failed to assign category.');
    } finally {
      setBulkCatAssigning(false);
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
      const result = await income.confirm(csvFile, columnMap, importCurrency, importDateFormat);
      const count = result.count ?? result.imported ?? 0;
      setImportMessage({ type: 'success', text: `Successfully imported ${count} income entries.` });
      setCsvFile(null);
      setParseResult(null);
      setColumnMap({ date: '', source: '', amount: '' });
      if (fileInputRef.current) fileInputRef.current.value = '';
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
    setImportDateFormat('DMY');
    setImportMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ---------- category name lookup ----------

  const catNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of incomeCategories) m.set(c.id, c.name);
    return m;
  }, [incomeCategories]);

  // ---------- sort ----------

  const handleSort = useCallback((key: IncomeSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.date.localeCompare(b.date);
          break;
        case 'source':
          cmp = a.source.localeCompare(b.source);
          break;
        case 'category': {
          const aName = catNameById.get((a as any).income_category_id ?? 0) ?? '';
          const bName = catNameById.get((b as any).income_category_id ?? 0) ?? '';
          cmp = aName.localeCompare(bName);
          break;
        }
        case 'amount_aud':
          cmp = a.amount_aud - b.amount_aud;
          break;
        case 'amount_original':
          cmp = a.amount_original - b.amount_original;
          break;
        case 'entry_type':
          cmp = (a.entry_type || '').localeCompare(b.entry_type || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [entries, sortKey, sortDir, catNameById]);

  // ---------- sort header helper ----------

  const SortTh = ({
    col, label, align = 'left',
  }: { col: IncomeSortKey; label: string; align?: 'left' | 'right' }) => {
    const active = sortKey === col;
    return (
      <th className={`py-3 px-4 font-medium text-${align}`}>
        <button
          onClick={() => handleSort(col)}
          className={`group inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {align === 'right' && (
            <span className={`text-xs ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
              {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
          )}
          {label}
          {align === 'left' && (
            <span className={`text-xs ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
              {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
          )}
        </button>
      </th>
    );
  };

  // ---------- render ----------

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Income</h1>
        <p className="text-muted-foreground mt-4">Loading income data…</p>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Income</h1>
        <p className="text-destructive mt-4">{error}</p>
        <button onClick={() => { setLoading(true); loadEntries(); }} className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">Retry</button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <h1 className="text-2xl font-bold">Income</h1>

      {/* Date filters */}
      <div className="flex flex-wrap items-end gap-3 mt-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {[new Date().getFullYear() - 1, new Date().getFullYear()].map((yr) => (
          <button
            key={yr}
            onClick={() => { setDateFrom(`${yr}-01-01`); setDateTo(`${yr}-12-31`); }}
            className="px-3 py-2 text-sm border border-input rounded-md hover:bg-muted transition-colors"
          >
            {yr}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          onClick={() => { setShowAddForm(!showAddForm); setShowImport(false); }}
          className={`px-4 py-2 rounded-md text-sm font-medium ${showAddForm ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
        >
          {showAddForm ? 'Close Form' : 'Add Income'}
        </button>
        <button
          onClick={() => { setShowImport(!showImport); setShowAddForm(false); }}
          className={`px-4 py-2 rounded-md text-sm font-medium ${showImport ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
        >
          {showImport ? 'Close Import' : 'Import CSV'}
        </button>
        <button
          onClick={() => setShowManageCats(!showManageCats)}
          className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1.5 ${showManageCats ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'border border-input hover:bg-muted'}`}
        >
          {showManageCats ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Manage Categories
          {incomeCategories.length > 0 && (
            <span className="ml-0.5 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">{incomeCategories.length}</span>
          )}
        </button>
      </div>

      {/* Manage Income Categories */}
      {showManageCats && (
        <div className="bg-card border rounded-lg p-4 mt-4 max-w-lg">
          <h2 className="text-sm font-semibold mb-3">Income Categories</h2>
          <p className="text-xs text-muted-foreground mb-3">These categories are separate from your expense categories and only appear when adding or editing income entries.</p>

          {/* Category list */}
          <div className="space-y-1 mb-3">
            {incomeCategories.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No income categories yet.</p>
            )}
            {incomeCategories.map((cat) => {
              if (editingCatId === cat.id) {
                return (
                  <div key={cat.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editCatName}
                      onChange={(e) => setEditCatName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRenameCat(cat.id); if (e.key === 'Escape') setEditingCatId(null); }}
                      autoFocus
                      disabled={renamingCat}
                      className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button onClick={() => handleRenameCat(cat.id)} disabled={renamingCat} className="p-1 rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900"><Check size={14} /></button>
                    <button onClick={() => setEditingCatId(null)} disabled={renamingCat} className="p-1 rounded text-muted-foreground hover:bg-muted"><X size={14} /></button>
                  </div>
                );
              }
              if (deletingCatId === cat.id) {
                return (
                  <div key={cat.id} className="flex items-center gap-2">
                    <span className="text-sm text-destructive flex-1">Delete "{cat.name}"?</span>
                    <button onClick={() => handleDeleteCat(cat.id)} className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90">Confirm</button>
                    <button onClick={() => setDeletingCatId(null)} className="px-2 py-1 text-xs rounded bg-secondary text-secondary-foreground hover:bg-secondary/80">Cancel</button>
                  </div>
                );
              }
              return (
                <div key={cat.id} className="flex items-center gap-2 group py-1">
                  <span className="text-sm flex-1">{cat.name}</span>
                  <button onClick={() => { setEditingCatId(cat.id); setEditCatName(cat.name); }} className="p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-muted transition-opacity"><Pencil size={13} /></button>
                  <button onClick={() => handleDeleteCat(cat.id)} className="p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-opacity"><Trash2 size={13} /></button>
                </div>
              );
            })}
          </div>

          {/* Add new category */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCat(); }}
              placeholder="New category name…"
              className="flex-1 px-2 py-1.5 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button onClick={handleAddCat} disabled={addingCat || !newCatName.trim()} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1">
              <Plus size={14} />{addingCat ? '…' : 'Add'}
            </button>
          </div>
          {addCatError && <p className="text-xs text-destructive mt-1">{addCatError}</p>}
        </div>
      )}

      {/* Add Income Form */}
      {showAddForm && (
        <div className="bg-card border rounded-lg p-4 mt-4 max-w-lg space-y-4">
          <h2 className="text-lg font-semibold">Add Income</h2>

          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Source</label>
            <input type="text" value={formSource} onChange={(e) => setFormSource(e.target.value)} placeholder="e.g. Employer, Freelance, Dividends"
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <input type="number" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} placeholder="0.00" min="0" step="0.01"
                className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select value={formCurrency} onChange={(e) => setFormCurrency(e.target.value as 'AUD' | 'USD')}
                className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="AUD">AUD</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category (optional)</label>
            <select value={formCategoryId} onChange={(e) => setFormCategoryId(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value={0}>— No category —</option>
              {incomeCategories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
            {incomeCategories.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">No income categories yet — <button onClick={() => setShowManageCats(true)} className="underline">add some</button>.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Note (optional)</label>
            <textarea value={formNote} onChange={(e) => setFormNote(e.target.value)} placeholder="Any additional details…" rows={2}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
          </div>
          <button onClick={handleSave} disabled={formSaving} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
            {formSaving ? 'Saving…' : 'Save'}
          </button>
          {formMessage && (
            <p className={`text-sm ${formMessage.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>{formMessage.text}</p>
          )}
        </div>
      )}

      {/* CSV Import Section */}
      {showImport && (
        <div className="bg-card border rounded-lg p-4 mt-4 max-w-2xl space-y-4">
          <h2 className="text-lg font-semibold">Import CSV</h2>
          <div>
            <label className="block text-sm font-medium mb-1">CSV File</label>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange}
              className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-secondary-foreground hover:file:bg-secondary/80" />
          </div>
          {parsing && <p className="text-sm text-muted-foreground">Parsing CSV file…</p>}
          {parseResult && (
            <>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Map Columns</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(['date', 'source', 'amount'] as const).map((field) => (
                    <div key={field}>
                      <label className="block text-xs font-medium mb-1 text-muted-foreground capitalize">{field === 'source' ? 'Source / Description' : field.charAt(0).toUpperCase() + field.slice(1) + ' Column'}</label>
                      <select value={columnMap[field]} onChange={(e) => setColumnMap((prev) => ({ ...prev, [field]: e.target.value }))}
                        className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                        <option value="">-- Select --</option>
                        {parseResult.columns.map((col) => <option key={col} value={col}>{col}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 max-w-sm">
                  <div>
                    <label className="block text-xs font-medium mb-1 text-muted-foreground">Date Format</label>
                    <select value={importDateFormat} onChange={(e) => setImportDateFormat(e.target.value as 'DMY' | 'MDY' | 'ISO')}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="DMY">DD/MM/YYYY (Australian)</option>
                      <option value="MDY">MM/DD/YYYY (US)</option>
                      <option value="ISO">YYYY-MM-DD (ISO)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1 text-muted-foreground">Currency</label>
                    <select value={importCurrency} onChange={(e) => setImportCurrency(e.target.value as 'AUD' | 'USD')}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="AUD">AUD</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                </div>
              </div>
              {parseResult.sampleRows.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Sample Data</h3>
                  <div className="overflow-x-auto border rounded-md">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-muted">{parseResult.columns.map((col) => <th key={col} className="text-left py-2 px-3 font-medium text-xs">{col}</th>)}</tr></thead>
                      <tbody>{parseResult.sampleRows.slice(0, 3).map((row, idx) => <tr key={idx} className="border-t">{parseResult.columns.map((col) => <td key={col} className="py-2 px-3 text-xs">{row[col] ?? ''}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={handleConfirmImport} disabled={confirming} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">{confirming ? 'Importing…' : 'Confirm Import'}</button>
                <button onClick={handleResetImport} disabled={confirming} className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50">Reset</button>
              </div>
            </>
          )}
          {importMessage && <p className={`text-sm ${importMessage.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>{importMessage.text}</p>}
        </div>
      )}

      {/* Summary card */}
      <div className="mt-6">
        <div className="bg-card border rounded-lg p-4 inline-block min-w-[200px]">
          <p className="text-sm text-muted-foreground">Total Income ({entries.length} entries)</p>
          <p className="text-2xl font-bold mt-1">{formatCurrency(periodTotal)}</p>
        </div>
      </div>

      {/* Income table */}
      <div className="mt-6 overflow-x-auto">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No income entries yet. Add one manually or import from CSV.</p>
        ) : (
          <>
            {/* Bulk action toolbar */}
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-3 px-1 py-2 bg-muted/50 rounded-lg border">
                <span className="text-sm font-medium text-muted-foreground pl-1">
                  {selectedIds.size} {selectedIds.size === 1 ? 'entry' : 'entries'} selected
                </span>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Assign category */}
                <select
                  value={bulkCatId}
                  onChange={(e) => setBulkCatId(parseInt(e.target.value, 10))}
                  disabled={bulkCatAssigning}
                  className="px-2 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value={0}>— No category —</option>
                  {incomeCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkAssignCategory}
                  disabled={bulkCatAssigning}
                  className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {bulkCatAssigning ? 'Assigning…' : 'Assign category'}
                </button>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Delete */}
                {confirmBulkDelete ? (
                  <>
                    <span className="text-sm font-medium text-destructive">Delete {selectedIds.size} {selectedIds.size === 1 ? 'entry' : 'entries'}?</span>
                    <button onClick={handleBulkDelete} disabled={bulkDeleting} className="px-3 py-1.5 text-sm rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">{bulkDeleting ? 'Deleting…' : 'Confirm'}</button>
                    <button onClick={() => setConfirmBulkDelete(false)} disabled={bulkDeleting} className="px-3 py-1.5 text-sm rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80">Cancel</button>
                  </>
                ) : (
                  <button onClick={handleBulkDelete} className="px-3 py-1.5 text-sm rounded-md border border-destructive text-destructive hover:bg-destructive/10">
                    Delete selected
                  </button>
                )}

                <button onClick={clearSelection} className="ml-auto px-3 py-1.5 text-sm rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80">
                  Clear selection
                </button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-3 pl-4 pr-2 w-8">
                    <input type="checkbox"
                      checked={selectedIds.size === entries.length && entries.length > 0}
                      ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < entries.length; }}
                      onChange={(e) => e.target.checked ? selectAll(entries.map((en) => en.id)) : clearSelection()}
                      className="rounded border-input cursor-pointer" />
                  </th>
                  <SortTh col="date" label="Date" />
                  <SortTh col="source" label="Source" />
                  <SortTh col="category" label="Category" />
                  <SortTh col="amount_aud" label="Amount (AUD)" align="right" />
                  <SortTh col="amount_original" label="Original Amount" align="right" />
                  <SortTh col="entry_type" label="Type" />
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Note</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody>
                {sortedEntries.map((entry) => {
                  const isEditing = editingId === entry.id;
                  const isConfirmingDelete = deletingId === entry.id;
                  const isSelected = selectedIds.has(entry.id);
                  const incomeCatId = (entry as any).income_category_id;
                  const incomeCatName = incomeCatId ? (catNameById.get(incomeCatId) ?? '—') : '—';

                  if (isEditing) {
                    return (
                      <tr key={entry.id} className="border-b bg-muted/30">
                        <td className="py-2 pl-4 pr-2" />
                        <td className="py-2 px-4">
                          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                        </td>
                        <td className="py-2 px-4">
                          <input type="text" value={editSource} onChange={(e) => setEditSource(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                        </td>
                        <td className="py-2 px-4">
                          <select value={editCategoryId} onChange={(e) => setEditCategoryId(parseInt(e.target.value, 10))}
                            className="w-full px-2 py-1 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring">
                            <option value={0}>— None —</option>
                            {incomeCategories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                          </select>
                        </td>
                        <td className="py-2 px-4 text-right text-muted-foreground text-sm">—</td>
                        <td className="py-2 px-4">
                          <div className="flex gap-1 justify-end">
                            <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} min="0" step="0.01"
                              className="w-24 px-2 py-1 text-sm border border-input rounded bg-background text-right focus:outline-none focus:ring-2 focus:ring-ring" />
                            <select value={editCurrency} onChange={(e) => setEditCurrency(e.target.value as 'AUD' | 'USD')}
                              className="px-1 py-1 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring">
                              <option value="AUD">AUD</option>
                              <option value="USD">USD</option>
                            </select>
                          </div>
                        </td>
                        <td className="py-2 px-4">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${entry.entry_type === 'manual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                            {entry.entry_type === 'manual' ? 'Manual' : 'CSV Import'}
                          </span>
                        </td>
                        <td className="py-2 px-4">
                          <input type="text" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Optional note"
                            className="w-full px-2 py-1 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                        </td>
                        <td className="py-2 px-4">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => handleUpdate(entry.id)} disabled={editSaving} title="Save" className="p-1.5 rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900 disabled:opacity-50"><Check size={15} /></button>
                            <button onClick={cancelEdit} disabled={editSaving} title="Cancel" className="p-1.5 rounded text-muted-foreground hover:bg-muted"><X size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={entry.id} className={`border-b hover:bg-muted/50 group ${isSelected ? 'bg-primary/5' : ''}`}>
                      <td className="py-3 pl-4 pr-2">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(entry.id)} className="rounded border-input cursor-pointer" />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">{formatDate(entry.date)}</td>
                      <td className="py-3 px-4">{entry.source}</td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">{incomeCatName}</td>
                      <td className="py-3 px-4 text-right font-medium whitespace-nowrap">{formatCurrency(entry.amount_aud)}</td>
                      <td className="py-3 px-4 text-right whitespace-nowrap text-muted-foreground">
                        {entry.currency_original === 'USD' ? formatCurrency(entry.amount_original, 'USD') : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${entry.entry_type === 'manual' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'}`}>
                          {entry.entry_type === 'manual' ? 'Manual' : 'CSV Import'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground">{entry.note || '—'}</td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setDeletingId(null); startEdit(entry); }} title="Edit" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"><Pencil size={14} /></button>
                          {isConfirmingDelete ? (
                            <>
                              <button onClick={() => handleDelete(entry.id)} title="Confirm delete" className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete?</button>
                              <button onClick={() => setDeletingId(null)} title="Cancel delete" className="p-1.5 rounded text-muted-foreground hover:bg-muted"><X size={14} /></button>
                            </>
                          ) : (
                            <button onClick={() => handleDelete(entry.id)} title="Delete" className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
