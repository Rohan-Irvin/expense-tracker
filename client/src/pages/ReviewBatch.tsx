import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { importApi, categories as categoriesApi, expenses as expensesApi } from '@/api/client';
import type { ExpenseWithSuggestion, CategoryWithChildren, ImportBatch, SplitRow } from '@/types';
import ExpenseCard from '@/components/ExpenseCard';
import SplitDialog from '@/components/SplitDialog';

type FilterType = 'all' | 'pending' | 'approved' | 'skipped';

const PAGE_SIZE = 20;

export default function ReviewBatch() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();

  // Data state
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [allExpenses, setAllExpenses] = useState<ExpenseWithSuggestion[]>([]);
  const [categories, setCategories] = useState<CategoryWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [filter, setFilter] = useState<FilterType>('all');
  const [page, setPage] = useState(1);
  const [splitTarget, setSplitTarget] = useState<ExpenseWithSuggestion | null>(null);
  const [showConfirmAll, setShowConfirmAll] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Resume categorization state
  const [categorizingResume, setCategorizingResume] = useState(false);
  const [resumeProgress, setResumeProgress] = useState<{ done: number; total: number } | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const resumeAbortRef = useRef<AbortController | null>(null);

  // Load batch data
  const loadData = useCallback(async () => {
    if (!batchId) return;
    try {
      const [reviewData, catData] = await Promise.all([
        importApi.review(Number(batchId)),
        categoriesApi.list(),
      ]);
      setBatch(reviewData.batch);
      setAllExpenses(reviewData.expenses);
      setCategories(catData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load batch data.');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Counts for summary bar
  const counts = useMemo(() => {
    const pending = allExpenses.filter((e) => e.review_status === 'pending').length;
    const approvedRule = allExpenses.filter((e) => e.review_status === 'approved' && e.confidence === 'rule').length;
    const approvedOther = allExpenses.filter((e) => e.review_status === 'approved' && e.confidence !== 'rule').length;
    const skipped = allExpenses.filter((e) => e.review_status === 'skipped').length;
    const split = allExpenses.filter((e) => e.review_status === 'split').length;
    return { pending, approvedRule, approvedOther, skipped, split };
  }, [allExpenses]);

  // Filtered expenses
  const filteredExpenses = useMemo(() => {
    if (filter === 'all') return allExpenses;
    if (filter === 'pending') return allExpenses.filter((e) => e.review_status === 'pending');
    if (filter === 'approved') return allExpenses.filter((e) => e.review_status === 'approved' || e.review_status === 'split');
    if (filter === 'skipped') return allExpenses.filter((e) => e.review_status === 'skipped');
    return allExpenses;
  }, [allExpenses, filter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / PAGE_SIZE));
  const paginatedExpenses = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredExpenses.slice(start, start + PAGE_SIZE);
  }, [filteredExpenses, page]);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setPage(1);
  }, [filter]);

  // Clamp page if it goes out of range (e.g. after bulk action reduces items)
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // Actions
  const handleApprove = async (id: number, categoryId: number, subcategoryId?: number) => {
    try {
      await expensesApi.approve(id, { category_id: categoryId, subcategory_id: subcategoryId });
      setAllExpenses((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, review_status: 'approved' as const, category_id: categoryId, subcategory_id: subcategoryId ?? null }
            : e
        )
      );
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Failed to approve: ${err.message}` });
    }
  };

  const handleSkip = async (id: number) => {
    try {
      await expensesApi.skip(id);
      setAllExpenses((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, review_status: 'skipped' as const } : e
        )
      );
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Failed to skip: ${err.message}` });
    }
  };

  const handleSplitOpen = (expense: ExpenseWithSuggestion) => {
    setSplitTarget(expense);
  };

  const handleSplitConfirm = async (rows: SplitRow[]) => {
    if (!splitTarget) return;
    try {
      await expensesApi.split(splitTarget.id, rows);
      setSplitTarget(null);
      // Reload the full data to get updated children/statuses
      await loadData();
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Failed to split: ${err.message}` });
    }
  };

  // Bulk: Approve all high-confidence
  const highConfidencePending = useMemo(
    () => allExpenses.filter((e) => e.review_status === 'pending' && e.confidence === 'high' && e.suggested_category_id),
    [allExpenses]
  );

  const handleApproveHighConfidence = async () => {
    if (highConfidencePending.length === 0) return;
    setBulkActionLoading(true);
    setStatusMessage(null);
    try {
      await Promise.all(
        highConfidencePending.map((e) =>
          expensesApi.approve(e.id, {
            category_id: e.suggested_category_id!,
            subcategory_id: e.suggested_subcategory_id ?? undefined,
          })
        )
      );
      // Update local state
      const ids = new Set(highConfidencePending.map((e) => e.id));
      setAllExpenses((prev) =>
        prev.map((e) =>
          ids.has(e.id)
            ? { ...e, review_status: 'approved' as const, category_id: e.suggested_category_id, subcategory_id: e.suggested_subcategory_id }
            : e
        )
      );
      setStatusMessage({ type: 'success', text: `Approved ${highConfidencePending.length} high-confidence expenses.` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Bulk approve failed: ${err.message}` });
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Bulk: Approve all pending
  const allPendingWithCategory = useMemo(
    () => allExpenses.filter((e) => e.review_status === 'pending' && (e.suggested_category_id || e.category_id)),
    [allExpenses]
  );

  const handleApproveAll = async () => {
    setShowConfirmAll(false);
    if (allPendingWithCategory.length === 0) return;
    setBulkActionLoading(true);
    setStatusMessage(null);
    try {
      await Promise.all(
        allPendingWithCategory.map((e) => {
          const catId = e.suggested_category_id ?? e.category_id;
          const subId = e.suggested_subcategory_id ?? e.subcategory_id;
          return expensesApi.approve(e.id, {
            category_id: catId!,
            subcategory_id: subId ?? undefined,
          });
        })
      );
      const ids = new Set(allPendingWithCategory.map((e) => e.id));
      setAllExpenses((prev) =>
        prev.map((e) =>
          ids.has(e.id)
            ? {
                ...e,
                review_status: 'approved' as const,
                category_id: e.suggested_category_id ?? e.category_id,
                subcategory_id: e.suggested_subcategory_id ?? e.subcategory_id,
              }
            : e
        )
      );
      setStatusMessage({ type: 'success', text: `Approved ${allPendingWithCategory.length} expenses.` });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Bulk approve failed: ${err.message}` });
    } finally {
      setBulkActionLoading(false);
    }
  };

  // Expenses that are pending AND have no LLM/rule suggestion at all — need (re)categorization
  const uncategorizedPending = useMemo(
    () => allExpenses.filter((e) => e.review_status === 'pending' && !e.confidence),
    [allExpenses]
  );

  // Resume categorization: re-trigger the SSE categorize endpoint.
  // The server skips expenses already processed (those with an llm_suggestions row),
  // so this is safe to call multiple times.
  const handleResumeCategorization = useCallback(async () => {
    if (!batchId || categorizingResume) return;

    const abortController = new AbortController();
    resumeAbortRef.current = abortController;
    setCategorizingResume(true);
    setResumeError(null);
    setResumeProgress({ done: 0, total: 0 });

    try {
      const response = await fetch(`/api/import/${batchId}/categorize`, {
        method: 'POST',
        signal: abortController.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        setResumeError(err.error || 'Failed to start categorization.');
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let didComplete = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const event = JSON.parse(trimmed.slice(6));
              setResumeProgress({ done: event.done, total: event.total });
              if (event.error) {
                setResumeError(event.error);
              }
              if (event.complete) {
                didComplete = true;
              }
            } catch {
              // Ignore malformed SSE lines
            }
          }
        }
      }

      if (didComplete) {
        // Reload data to pick up the new suggestions from this run
        setLoading(true);
        await loadData();
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setResumeError(err.message || 'Categorization failed.');
      }
    } finally {
      setCategorizingResume(false);
    }
  }, [batchId, categorizingResume, loadData]);

  // Finalize
  const handleFinalize = async () => {
    if (!batchId) return;
    setFinalizing(true);
    setStatusMessage(null);
    try {
      await importApi.finalize(Number(batchId));
      navigate('/expenses');
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Finalize failed: ${err.message}` });
      setFinalizing(false);
    }
  };

  // Build page number array for pagination
  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  }, [page, totalPages]);

  // Loading state
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Review Batch</h1>
        <p className="text-muted-foreground mt-4">Loading batch data...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Review Batch</h1>
        <p className="text-destructive mt-4">{error}</p>
        <button
          onClick={() => { setLoading(true); loadData(); }}
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Review Batch</h1>
          {batch && (
            <p className="text-sm text-muted-foreground mt-1">
              {batch.filename} -- {allExpenses.length} transactions
            </p>
          )}
        </div>
        <button
          onClick={handleFinalize}
          disabled={counts.pending > 0 || finalizing}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {finalizing ? 'Finalizing...' : 'Finalize Batch'}
        </button>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div className={`mt-4 p-3 rounded-md text-sm ${statusMessage.type === 'success' ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200' : 'bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>
          {statusMessage.text}
          <button
            onClick={() => setStatusMessage(null)}
            className="ml-2 underline text-xs"
          >
            dismiss
          </button>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap gap-2 mt-4">
        <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
          {counts.pending} Pending
        </span>
        <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          {counts.approvedRule} Approved (Rule)
        </span>
        <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
          {counts.approvedOther} Approved (LLM/User)
        </span>
        <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {counts.skipped} Skipped
        </span>
        {counts.split > 0 && (
          <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
            {counts.split} Split
          </span>
        )}
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-2 mt-4">
        <button
          onClick={handleApproveHighConfidence}
          disabled={highConfidencePending.length === 0 || bulkActionLoading}
          className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve All High-Confidence ({highConfidencePending.length})
        </button>
        <button
          onClick={() => setShowConfirmAll(true)}
          disabled={allPendingWithCategory.length === 0 || bulkActionLoading}
          className="px-3 py-1.5 text-sm font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Approve All ({allPendingWithCategory.length})
        </button>
      </div>

      {/* Confirm All dialog */}
      {showConfirmAll && (
        <div className="mt-3 p-4 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            Are you sure you want to approve <strong>{allPendingWithCategory.length}</strong> pending expenses using their suggested categories?
          </p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleApproveAll}
              disabled={bulkActionLoading}
              className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {bulkActionLoading ? 'Approving...' : 'Yes, Approve All'}
            </button>
            <button
              onClick={() => setShowConfirmAll(false)}
              className="px-3 py-1.5 text-sm font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Resume Categorization banner — shown when uncategorized pending expenses exist */}
      {uncategorizedPending.length > 0 && !categorizingResume && (
        <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {uncategorizedPending.length} expense{uncategorizedPending.length !== 1 ? 's' : ''} have not been categorized yet.
            </p>
            {resumeError && (
              <p className="mt-1 text-xs text-red-700 dark:text-red-300">{resumeError}</p>
            )}
          </div>
          <button
            onClick={handleResumeCategorization}
            className="shrink-0 px-3 py-1.5 text-sm font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700"
          >
            Resume Categorization
          </button>
        </div>
      )}

      {/* Inline categorization progress (while resume is running) */}
      {categorizingResume && resumeProgress && (
        <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg space-y-2">
          <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
            Categorizing… {resumeProgress.done} / {resumeProgress.total}
            {resumeProgress.total > 0 && ` (${Math.round((resumeProgress.done / resumeProgress.total) * 100)}%)`}
          </p>
          <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${resumeProgress.total > 0 ? Math.round((resumeProgress.done / resumeProgress.total) * 100) : 0}%` }}
            />
          </div>
          {resumeError && (
            <p className="text-xs text-red-700 dark:text-red-300">{resumeError}</p>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-1 mt-4 bg-muted rounded-lg p-1">
        {(['all', 'pending', 'approved', 'skipped'] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === f
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            <span className="ml-1 text-xs text-muted-foreground">
              ({f === 'all'
                ? allExpenses.length
                : f === 'pending'
                  ? counts.pending
                  : f === 'approved'
                    ? counts.approvedRule + counts.approvedOther + counts.split
                    : counts.skipped})
            </span>
          </button>
        ))}
      </div>

      {/* Expense list */}
      <div className="mt-4 space-y-3">
        {paginatedExpenses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No expenses match the selected filter.
          </p>
        ) : (
          paginatedExpenses.map((expense) => (
            <ExpenseCard
              key={expense.id}
              expense={expense}
              categories={categories}
              onApprove={handleApprove}
              onSkip={handleSkip}
              onSplit={handleSplitOpen}
            />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-2 py-1 text-sm border border-input rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Prev
          </button>
          {pageNumbers.map((pn, idx) =>
            pn === 'ellipsis' ? (
              <span key={`ellipsis-${idx}`} className="px-2 py-1 text-sm text-muted-foreground">
                ...
              </span>
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
            className="px-2 py-1 text-sm border border-input rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* Pending count reminder at bottom */}
      {counts.pending > 0 && (
        <p className="text-center text-sm text-muted-foreground mt-4">
          {counts.pending} expense{counts.pending !== 1 ? 's' : ''} still pending review.
          Finalize is available when all expenses are reviewed.
        </p>
      )}

      {/* Split dialog */}
      {splitTarget && (
        <SplitDialog
          expense={splitTarget}
          categories={categories}
          onSplit={handleSplitConfirm}
          onClose={() => setSplitTarget(null)}
        />
      )}
    </div>
  );
}
