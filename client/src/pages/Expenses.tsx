import { useState, useEffect, useMemo, useCallback } from 'react';
import { expenses, categories as categoriesApi, accounts as accountsApi } from '@/api/client';
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

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'skipped', label: 'Skipped' },
];

function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
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
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    skipped: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    split: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${styles[status] || ''}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function Expenses() {
  // Filter state
  const [month, setMonth] = useState(getCurrentMonth);
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  // Data state
  const [data, setData] = useState<ExpensesResponse | null>(null);
  const [categoriesList, setCategoriesList] = useState<CategoryWithChildren[]>([]);
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load categories and accounts once
  useEffect(() => {
    Promise.all([categoriesApi.list(), accountsApi.list()])
      .then(([catData, accData]) => {
        // Build category tree: parent categories with children
        const allCats = catData as any[];
        const topLevel = allCats.filter((c: any) => c.parent_id === null);
        const withChildren: CategoryWithChildren[] = topLevel.map((parent: any) => ({
          ...parent,
          children: allCats.filter((c: any) => c.parent_id === parent.id),
        }));
        setCategoriesList(withChildren);
        setAccountsList(accData as Account[]);
      })
      .catch(() => {
        // Non-blocking: filters will just show empty dropdowns
      });
  }, []);

  // Fetch expenses whenever filters or page changes
  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(limit),
      };
      if (month) params.month = month;
      if (categoryId) params.category_id = categoryId;
      if (accountId) params.account_id = accountId;
      if (status) params.status = status;

      const result = await expenses.list(params) as ExpensesResponse;
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load expenses.');
    } finally {
      setLoading(false);
    }
  }, [month, categoryId, accountId, status, page, limit]);

  useEffect(() => {
    fetchExpenses();
  }, [fetchExpenses]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [month, categoryId, accountId, status]);

  // Compute pagination display
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;
  const expensesList = data?.expenses ?? [];

  const rangeStart = expensesList.length > 0 ? (page - 1) * limit + 1 : 0;
  const rangeEnd = expensesList.length > 0 ? rangeStart + expensesList.length - 1 : 0;

  // Build page numbers with ellipsis
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

  // Compute total AUD sum from visible expenses
  const visibleTotal = useMemo(() => {
    return expensesList.reduce((sum, e) => sum + e.amount_aud, 0);
  }, [expensesList]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} total expense{total !== 1 ? 's' : ''} found
          </p>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-3 mt-6">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Month</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Categories</option>
            {categoriesList.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
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
              <option key={acc.id} value={acc.id}>
                {acc.name} ({acc.currency})
              </option>
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
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary row */}
      <div className="flex items-center gap-6 mt-4 py-3 px-4 bg-muted/50 rounded-lg text-sm">
        <div>
          <span className="text-muted-foreground">Showing:</span>{' '}
          <span className="font-medium">{expensesList.length} expense{expensesList.length !== 1 ? 's' : ''}</span>
          {total > limit && (
            <span className="text-muted-foreground"> of {total}</span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Page total:</span>{' '}
          <span className="font-medium text-red-600 dark:text-red-400">{formatCurrency(visibleTotal)}</span>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-4 p-3 rounded-md text-sm bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
          <button
            onClick={fetchExpenses}
            className="ml-2 underline text-xs"
          >
            retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <p className="text-muted-foreground mt-6 text-sm">Loading expenses...</p>
      )}

      {/* Expenses table */}
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
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50">Date</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50">Description</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50">Category</th>
                    <th className="text-right py-3 px-4 font-medium text-muted-foreground bg-muted/50">Amount (AUD)</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground bg-muted/50">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {expensesList.map((expense) => {
                    const categoryDisplay = expense.category_name
                      ? expense.subcategory_name
                        ? `${expense.category_name} > ${expense.subcategory_name}`
                        : expense.category_name
                      : '';
                    const isUsd = expense.currency_original === 'USD';

                    return (
                      <tr key={expense.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap">
                          {formatDate(expense.date)}
                        </td>
                        <td className="py-3 px-4">
                          <span title={expense.description}>
                            {truncate(expense.description, 50)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {categoryDisplay || <span className="italic text-muted-foreground/60">Uncategorized</span>}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="text-red-600 dark:text-red-400 font-medium">
                            {formatCurrency(expense.amount_aud)}
                          </div>
                          {isUsd && (
                            <div className="text-xs text-muted-foreground">
                              {formatUsd(expense.amount_original)} USD
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {statusBadge(expense.review_status)}
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
                Showing {rangeStart}-{rangeEnd} of {total}
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
