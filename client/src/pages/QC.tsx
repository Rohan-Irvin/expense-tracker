import { useState, useEffect, useMemo, useCallback } from 'react';
import { expenses as expensesApi, categories as categoriesApi } from '@/api/client';
import type { CategoryWithChildren } from '@/types';
import { useQCCount } from '@/context/QCCountContext';

interface QCExpense {
  id: number;
  date: string;
  description: string;
  amount_aud: number;
  amount_original: number;
  currency_original: string;
  review_status: string;
  category_id: number | null;
  subcategory_id: number | null;
  category_name: string | null;
  subcategory_name: string | null;
  issue_type: 'uncategorized' | 'mismatch';
}

interface QCResponse {
  expenses: QCExpense[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const LIMIT = 50;

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${months[parseInt(m, 10) - 1]} ${y}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', minimumFractionDigits: 2,
  }).format(Math.abs(amount));
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen).trimEnd() + '...';
}

function IssueBadge({ type }: { type: 'uncategorized' | 'mismatch' }) {
  if (type === 'uncategorized') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 whitespace-nowrap">
        No Category
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 whitespace-nowrap">
      Subcategory Mismatch
    </span>
  );
}

export default function QC() {
  const { refresh: refreshQCCount } = useQCCount();

  const [page, setPage] = useState(1);
  const [data, setData] = useState<QCResponse | null>(null);
  const [categoriesList, setCategoriesList] = useState<CategoryWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCatId, setEditCatId] = useState<number>(0);
  const [editSubcatId, setEditSubcatId] = useState<number>(0);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    categoriesApi.list()
      .then((cats: any[]) => setCategoriesList(cats as CategoryWithChildren[]))
      .catch(() => {});
  }, []);

  const fetchQC = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await expensesApi.qcList({ page: String(page), limit: String(LIMIT) }) as QCResponse;
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load QC issues.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchQC(); }, [fetchQC]);
  useEffect(() => { setPage(1); }, []);

  const total = data?.total ?? 0;
  const expenses = data?.expenses ?? [];
  const totalPages = data?.totalPages ?? 1;
  const rangeStart = expenses.length > 0 ? (page - 1) * LIMIT + 1 : 0;
  const rangeEnd   = expenses.length > 0 ? rangeStart + expenses.length - 1 : 0;

  const editSubcatOptions = useMemo(
    () => categoriesList.find((c) => c.id === editCatId)?.children ?? [],
    [editCatId, categoriesList]
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

  const startEdit = (expense: QCExpense) => {
    setEditingId(expense.id);
    setEditCatId(expense.category_id ?? 0);
    setEditSubcatId(expense.subcategory_id ?? 0);
  };

  const cancelEdit = () => { setEditingId(null); setEditSaving(false); };

  const saveEdit = async () => {
    if (!editingId) return;
    setEditSaving(true);
    try {
      await expensesApi.update(editingId, {
        category_id:    editCatId    || null,
        subcategory_id: editSubcatId || null,
      });
      setEditingId(null);
      await fetchQC();
      refreshQCCount();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categorization QC</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} issue{total !== 1 ? 's' : ''} — expenses with no category or a mismatched subcategory
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-md text-sm bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
          <button onClick={fetchQC} className="ml-2 underline text-xs">retry</button>
        </div>
      )}

      {loading && <p className="text-muted-foreground mt-6 text-sm">Loading…</p>}

      {!loading && !error && (
        <>
          {expenses.length === 0 ? (
            <div className="mt-12 text-center">
              <p className="text-2xl mb-2">✓</p>
              <p className="text-sm text-muted-foreground">No categorization issues found.</p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50 w-32">Date</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50">Description</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50 w-44">Current Category</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50 w-44">Issue</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground bg-muted/50 w-36">Amount (AUD)</th>
                    <th className="py-3 px-4 bg-muted/50 w-32">{/* actions */}</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => {
                    const isEditing = editingId === expense.id;

                    if (isEditing) {
                      return (
                        <tr key={expense.id} className="border-b border-border bg-muted/20">
                          <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                            {formatDate(expense.date)}
                          </td>
                          <td className="py-3 px-4">
                            <span title={expense.description} className="text-xs">
                              {truncate(expense.description, 60)}
                            </span>
                          </td>
                          <td className="py-3 px-4" colSpan={2}>
                            <div className="flex flex-col gap-1">
                              <select
                                value={editCatId}
                                onChange={(e) => { setEditCatId(parseInt(e.target.value, 10)); setEditSubcatId(0); }}
                                className="text-xs border border-input rounded px-1.5 py-1 bg-background w-full"
                              >
                                <option value={0}>No category</option>
                                {categoriesList.map((c) => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                              <select
                                value={editSubcatId}
                                onChange={(e) => setEditSubcatId(parseInt(e.target.value, 10))}
                                disabled={editSubcatOptions.length === 0}
                                className="text-xs border border-input rounded px-1.5 py-1 bg-background w-full disabled:opacity-40"
                              >
                                <option value={0}>No subcategory</option>
                                {editSubcatOptions.map((s) => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                            {formatCurrency(expense.amount_aud)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex gap-1">
                              <button
                                onClick={saveEdit}
                                disabled={editSaving || editCatId === 0}
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

                    const categoryDisplay = expense.category_name
                      ? expense.subcategory_name
                        ? `${expense.category_name} › ${expense.subcategory_name}`
                        : expense.category_name
                      : null;

                    return (
                      <tr key={expense.id} className="border-b border-border hover:bg-muted/30 transition-colors group">
                        <td className="py-3 px-4 whitespace-nowrap text-muted-foreground">
                          {formatDate(expense.date)}
                        </td>
                        <td className="py-3 px-4">
                          <span title={expense.description}>
                            {truncate(expense.description, 60)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {categoryDisplay ?? (
                            <span className="italic text-muted-foreground/60">None</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <IssueBadge type={expense.issue_type} />
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-red-600 dark:text-red-400 font-medium">
                          {formatCurrency(expense.amount_aud)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(expense)}
                              className="px-2 py-1 text-xs border border-input rounded hover:bg-muted"
                            >
                              Fix
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
