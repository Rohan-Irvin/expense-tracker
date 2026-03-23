import { useState, useEffect, useMemo, useCallback } from 'react';
import { expenses as expensesApi, categories as categoriesApi, accounts as accountsApi } from '@/api/client';
import type { Expense, CategoryWithChildren, Account } from '@/types';

interface ExpenseWithNames extends Expense {
  category_name?: string;
  subcategory_name?: string;
}

interface ExpensesResponse {
  expenses: ExpenseWithNames[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type SortKey = 'date' | 'description' | 'category_name' | 'amount_aud' | 'review_status';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'skipped', label: 'Skipped' },
];

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` };
}

// Add one day to a YYYY-MM-DD string (for inclusive date_to on the server)
function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
}

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount));
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function statusBadge(status: Expense['review_status']) {
  const styles: Record<string, string> = {
    approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    pending:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    skipped:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    split:    'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${styles[status] || ''}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

const LIMIT = 50;

export default function Expenses() {
  const defaults = getDefaultDateRange();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo,   setDateTo]   = useState(defaults.to);
  const [categoryId,    setCategoryId]    = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [accountId,  setAccountId]  = useState('');
  const [status,     setStatus]     = useState('');
  const [sortBy,  setSortBy]  = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // ── Remote data ───────────────────────────────────────────────────────────
  const [data,           setData]           = useState<ExpensesResponse | null>(null);
  const [categoriesList, setCategoriesList] = useState<CategoryWithChildren[]>([]);
  const [accountsList,   setAccountsList]   = useState<Account[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selectedIds,       setSelectedIds]       = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting,      setBulkDeleting]      = useState(false);

  // ── Inline edit ───────────────────────────────────────────────────────────
  const [editingId,      setEditingId]      = useState<number | null>(null);
  const [editDate,       setEditDate]       = useState('');
  const [editDesc,       setEditDesc]       = useState('');
  const [editCatId,      setEditCatId]      = useState<number>(0);
  const [editSubcatId,   setEditSubcatId]   = useState<number>(0);
  const [editSaving,     setEditSaving]     = useState(false);

  // ── Per-row delete confirm ────────────────────────────────────────────────
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // ── Load reference data once ──────────────────────────────────────────────
  useEffect(() => {
    Promise.all([categoriesApi.list(), accountsApi.list()])
      .then(([cats, accs]) => {
        setCategoriesList(cats as CategoryWithChildren[]);
        setAccountsList(accs as Account[]);
      })
      .catch(() => {});
  }, []);

  // ── Fetch expenses ────────────────────────────────────────────────────────
  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(LIMIT),
      };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = nextDay(dateTo); // exclusive upper bound
      if (categoryId)    params.category_id    = categoryId;
      if (subcategoryId) params.subcategory_id = subcategoryId;
      if (accountId)  params.account_id  = accountId;
      if (status)     params.status      = status;
      params.sort_by  = sortBy;
      params.sort_dir = sortDir;

      const result = await expensesApi.list(params) as ExpensesResponse;
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load expenses.');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, categoryId, subcategoryId, accountId, status, sortBy, sortDir, page]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  // Reset subcategory when category changes
  useEffect(() => { setSubcategoryId(''); }, [categoryId]);

  // Reset page to 1 when any filter or sort changes
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, categoryId, subcategoryId, accountId, status, sortBy, sortDir]);

  // Clear selection when page changes
  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  }, [page]);

  // ── Derived values ────────────────────────────────────────────────────────
  const totalPages    = data?.totalPages ?? 1;
  const total         = data?.total ?? 0;
  const expensesList  = data?.expenses ?? [];
  const rangeStart    = expensesList.length > 0 ? (page - 1) * LIMIT + 1 : 0;
  const rangeEnd      = expensesList.length > 0 ? rangeStart + expensesList.length - 1 : 0;

  const visibleTotal = useMemo(
    () => expensesList.reduce((s, e) => s + e.amount_aud, 0),
    [expensesList]
  );

  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      const start = Math.max(2, page - 1);
      const end   = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  }, [page, totalPages]);

  const filterSubcatOptions = useMemo(
    () => categoriesList.find((c) => String(c.id) === categoryId)?.children ?? [],
    [categoryId, categoriesList]
  );

  // Flat list of all subcategories across every parent — for the inline edit select
  const allEditSubcats = useMemo(
    () =>
      categoriesList.flatMap((c) =>
        c.children.map((s) => ({ id: s.id, name: s.name, parent_id: c.id, parent_name: c.name }))
      ),
    [categoriesList]
  );

  const allCurrentPageSelected =
    expensesList.length > 0 && expensesList.every((e) => selectedIds.has(e.id));

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleSelectAll = () => {
    if (allCurrentPageSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(expensesList.map((e) => e.id)));
    }
    setConfirmBulkDelete(false);
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setConfirmBulkDelete(false);
  };

  const startEdit = (expense: ExpenseWithNames) => {
    setEditingId(expense.id);
    setEditDate(expense.date);
    setEditDesc(expense.description);
    setEditCatId(expense.category_id ?? 0);
    setEditSubcatId(expense.subcategory_id ?? 0);
    setConfirmDeleteId(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditSaving(false); };

  const saveEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    try {
      await expensesApi.update(editingId, {
        date:          editDate,
        description:   editDesc,
        category_id:   editCatId    || null,
        subcategory_id: editSubcatId || null,
      });
      setEditingId(null);
      await fetchExpenses();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirmDeleteId !== id) { setConfirmDeleteId(id); return; }
    try {
      await expensesApi.delete(id);
      setConfirmDeleteId(null);
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      await fetchExpenses();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleBulkDelete = async () => {
    if (!confirmBulkDelete) { setConfirmBulkDelete(true); return; }
    setBulkDeleting(true);
    try {
      await Promise.all([...selectedIds].map((id) => expensesApi.delete(id)));
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
      await fetchExpenses();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const handleExportCsv = async () => {
    try {
      const params: Record<string, string> = { page: '1', limit: '100000' };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = nextDay(dateTo);
      if (categoryId)    params.category_id    = categoryId;
      if (subcategoryId) params.subcategory_id = subcategoryId;
      if (accountId)  params.account_id  = accountId;
      if (status)     params.status      = status;

      const result = await expensesApi.list(params) as ExpensesResponse;
      const rows = result.expenses;

      const header = ['Date', 'Description', 'Category', 'Subcategory', 'Amount AUD', 'Original Amount', 'Currency', 'Status'];
      const csvRows = rows.map((e) => [
        e.date,
        e.description,
        e.category_name ?? '',
        e.subcategory_name ?? '',
        e.amount_aud.toFixed(2),
        e.amount_original != null ? e.amount_original.toFixed(2) : e.amount_aud.toFixed(2),
        e.currency_original ?? 'AUD',
        e.review_status,
      ]);

      const csvContent = [header, ...csvRows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

      const from = dateFrom || 'all';
      const to   = dateTo   || 'all';
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `expenses_${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Export failed: ' + err.message);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} expense{total !== 1 ? 's' : ''} found
          </p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={total === 0}
          className="px-4 py-2 text-sm border border-input rounded-md hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mt-6">
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
        {/* Year quick-select */}
        {[new Date().getFullYear() - 1, new Date().getFullYear()].map((yr) => (
          <button
            key={yr}
            onClick={() => { setDateFrom(`${yr}-01-01`); setDateTo(`${yr}-12-31`); }}
            className="px-3 py-2 text-sm border border-input rounded-md hover:bg-muted transition-colors"
          >
            {yr}
          </button>
        ))}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Categories</option>
            {categoriesList.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Subcategory</label>
          <select
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={filterSubcatOptions.length === 0}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">All Subcategories</option>
            {filterSubcatOptions.map((sub) => (
              <option key={sub.id} value={sub.id}>{sub.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Account</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Accounts</option>
            {accountsList.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.name} ({acc.currency})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary bar / bulk-delete toolbar */}
      <div className="flex flex-wrap items-center gap-3 mt-4 py-3 px-4 bg-muted/50 rounded-lg text-sm min-h-[48px]">
        {selectedIds.size > 0 ? (
          <>
            <span className="font-medium">{selectedIds.size} row{selectedIds.size !== 1 ? 's' : ''} selected</span>
            {confirmBulkDelete ? (
              <>
                <span className="text-destructive text-xs font-medium">
                  Permanently delete {selectedIds.size} expense{selectedIds.size !== 1 ? 's' : ''}?
                </span>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="px-3 py-1 text-xs font-medium bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50"
                >
                  {bulkDeleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  className="px-3 py-1 text-xs font-medium border border-input rounded-md hover:bg-muted"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleBulkDelete}
                  className="px-3 py-1 text-xs font-medium border border-destructive text-destructive rounded-md hover:bg-destructive/10"
                >
                  Delete Selected
                </button>
                <button
                  onClick={() => { setSelectedIds(new Set()); setConfirmBulkDelete(false); }}
                  className="px-3 py-1 text-xs font-medium border border-input rounded-md hover:bg-muted"
                >
                  Clear Selection
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <div>
              <span className="text-muted-foreground">Showing:</span>{' '}
              <span className="font-medium">{expensesList.length}</span>
              {total > LIMIT && <span className="text-muted-foreground"> of {total}</span>}
            </div>
            <div>
              <span className="text-muted-foreground">Page total:</span>{' '}
              <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(visibleTotal)}</span>
            </div>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 rounded-md text-sm bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
          <button onClick={fetchExpenses} className="ml-2 underline text-xs">retry</button>
        </div>
      )}

      {/* Loading */}
      {loading && <p className="text-muted-foreground mt-6 text-sm">Loading expenses...</p>}

      {/* Table */}
      {!loading && !error && (
        <>
          {expensesList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No expenses found for the selected filters.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="py-3 px-3 bg-muted/50 w-9">
                      <input
                        type="checkbox"
                        checked={allCurrentPageSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-input cursor-pointer"
                        title="Select all on this page"
                      />
                    </th>
                    {(
                      [
                        { label: 'Date',        key: 'date'          as SortKey, align: 'left',  width: 'w-32' },
                        { label: 'Description', key: 'description'   as SortKey, align: 'left',  width: ''     },
                        { label: 'Category',    key: 'category_name' as SortKey, align: 'left',  width: 'w-52' },
                        { label: 'Amount (AUD)',key: 'amount_aud'    as SortKey, align: 'right', width: 'w-36' },
                        { label: 'Status',      key: 'review_status' as SortKey, align: 'left',  width: 'w-24' },
                      ] as const
                    ).map(({ label, key, align, width }) => {
                      const active = sortBy === key;
                      const indicator = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
                      return (
                        <th
                          key={key}
                          onClick={() => handleSort(key)}
                          className={`py-3 px-4 font-medium text-muted-foreground bg-muted/50 ${width} cursor-pointer select-none hover:text-foreground transition-colors ${align === 'right' ? 'text-right' : 'text-left'} ${active ? 'text-foreground' : ''}`}
                        >
                          {label}{indicator}
                        </th>
                      );
                    })}
                    <th className="py-3 px-4 bg-muted/50 w-32">{/* actions */}</th>
                  </tr>
                </thead>
                <tbody>
                  {expensesList.map((expense) => {
                    const isEditing  = editingId === expense.id;
                    const isSelected = selectedIds.has(expense.id);
                    const isConfirmingDelete = confirmDeleteId === expense.id;

                    /* ── Edit row ─────────────────────────────────────── */
                    if (isEditing) {
                      return (
                        <tr key={expense.id} className="border-b border-border bg-muted/20">
                          <td className="py-3 px-3" />
                          <td className="py-3 px-4">
                            <input
                              type="date"
                              value={editDate}
                              onChange={(e) => setEditDate(e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-input rounded bg-background"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <input
                              type="text"
                              value={editDesc}
                              onChange={(e) => setEditDesc(e.target.value)}
                              className="w-full px-2 py-1 text-xs border border-input rounded bg-background"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-1">
                              {editSubcatId !== 0 && (() => {
                                const sub = allEditSubcats.find((s) => s.id === editSubcatId);
                                return sub ? (
                                  <span className="text-xs text-muted-foreground">
                                    ↳ {sub.parent_name}
                                  </span>
                                ) : null;
                              })()}
                              <select
                                value={editSubcatId}
                                onChange={(e) => {
                                  const subId = parseInt(e.target.value, 10);
                                  setEditSubcatId(subId);
                                  if (subId !== 0) {
                                    const sub = allEditSubcats.find((s) => s.id === subId);
                                    if (sub) setEditCatId(sub.parent_id);
                                  } else {
                                    setEditCatId(0);
                                  }
                                }}
                                className="text-xs border border-input rounded px-1.5 py-1 bg-background w-full"
                              >
                                <option value={0}>No subcategory</option>
                                {allEditSubcats.map((s) => (
                                  <option key={s.id} value={s.id}>{s.name} ({s.parent_name})</option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                            {formatCurrency(expense.amount_aud)}
                          </td>
                          <td className="py-3 px-4">{statusBadge(expense.review_status)}</td>
                          <td className="py-3 px-4">
                            <div className="flex gap-1">
                              <button
                                onClick={saveEdit}
                                disabled={editSaving}
                                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                              >
                                {editSaving ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="px-2 py-1 text-xs border border-input rounded hover:bg-muted"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    /* ── Normal row ───────────────────────────────────── */
                    const categoryDisplay = expense.category_name
                      ? expense.subcategory_name
                        ? `${expense.category_name} › ${expense.subcategory_name}`
                        : expense.category_name
                      : '';
                    const isUsd = expense.currency_original === 'USD';

                    return (
                      <tr
                        key={expense.id}
                        className={`border-b border-border transition-colors group ${
                          isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
                        }`}
                      >
                        <td className="py-3 px-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(expense.id)}
                            className="rounded border-input cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
                          {formatDate(expense.date)}
                        </td>
                        <td className="py-3 px-4">
                          <span title={expense.description}>
                            {truncate(expense.description, 50)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {categoryDisplay || (
                            <span className="italic text-muted-foreground/60">Uncategorized</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="text-red-600 dark:text-red-400 font-medium tabular-nums">
                            {formatCurrency(expense.amount_aud)}
                          </div>
                          {isUsd && (
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {formatUsd(expense.amount_original)} USD
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">{statusBadge(expense.review_status)}</td>

                        {/* Actions — visible on row hover */}
                        <td className="py-3 px-4">
                          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            {isConfirmingDelete ? (
                              <>
                                <button
                                  onClick={() => handleDelete(expense.id)}
                                  className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 whitespace-nowrap"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 text-xs border border-input rounded hover:bg-muted"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(expense)}
                                  className="px-2 py-1 text-xs border border-input rounded hover:bg-muted"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(expense.id)}
                                  className="px-2 py-1 text-xs border border-input rounded text-destructive hover:bg-destructive/10"
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-4 mt-6">
              <p className="text-sm text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {total}
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 text-sm rounded-md border border-input hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                {pageNumbers.map((pn, idx) =>
                  pn === 'ellipsis' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 py-1 text-sm text-muted-foreground">…</span>
                  ) : (
                    <button
                      key={pn}
                      onClick={() => setPage(pn)}
                      className={`px-3 py-1 text-sm rounded-md ${
                        page === pn
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-input hover:bg-muted'
                      }`}
                    >
                      {pn}
                    </button>
                  )
                )}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 text-sm rounded-md border border-input hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
