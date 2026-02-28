import { useState, useEffect, useMemo, useRef } from 'react';
import { amazon } from '@/api/client';
import type { AmazonOrder, MatchResult } from '@/types';

type FilterTab = 'all' | 'matched' | 'unmatched';

export default function Amazon() {
  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ orders: number; items: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Matching state
  const [matching, setMatching] = useState(false);
  const [matchResults, setMatchResults] = useState<MatchResult[] | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  // Orders state
  const [orders, setOrders] = useState<AmazonOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // UI state
  const [filter, setFilter] = useState<FilterTab>('all');
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [unmatchingId, setUnmatchingId] = useState<number | null>(null);

  // Load orders on mount
  const loadOrders = async () => {
    try {
      const data = await amazon.orders();
      setOrders(data);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load orders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  // Filter counts
  const counts = useMemo(() => {
    const matched = orders.filter((o) => o.matched_expense_id !== null).length;
    const unmatched = orders.filter((o) => o.matched_expense_id === null).length;
    return { all: orders.length, matched, unmatched };
  }, [orders]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    if (filter === 'matched') return orders.filter((o) => o.matched_expense_id !== null);
    if (filter === 'unmatched') return orders.filter((o) => o.matched_expense_id === null);
    return orders;
  }, [orders, filter]);

  // Import handler
  const handleImport = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportError(null);
    setImportResult(null);

    try {
      const result = await amazon.import(file);
      setImportResult({
        orders: result.orders_imported ?? result.orders ?? 0,
        items: result.items_imported ?? result.items ?? 0,
      });
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Reload orders list
      await loadOrders();
    } catch (err: any) {
      setImportError(err.message || 'Failed to import CSV.');
    } finally {
      setImporting(false);
    }
  };

  // Run matching handler
  const handleRunMatching = async () => {
    setMatching(true);
    setMatchError(null);
    setMatchResults(null);

    try {
      const results: MatchResult[] = await amazon.match();
      setMatchResults(results);
      // Reload orders to reflect new matches
      await loadOrders();
    } catch (err: any) {
      setMatchError(err.message || 'Matching failed.');
    } finally {
      setMatching(false);
    }
  };

  // Unmatch handler
  const handleUnmatch = async (orderId: number) => {
    setUnmatchingId(orderId);
    try {
      await amazon.unmatch(orderId);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? { ...o, matched_expense_id: null, matched_expense: null }
            : o
        )
      );
    } catch (err: any) {
      // Show inline error briefly via alert for simplicity
      alert(`Failed to unmatch: ${err.message}`);
    } finally {
      setUnmatchingId(null);
    }
  };

  // Toggle item expansion
  const toggleExpanded = (orderId: number) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  // Format currency
  const formatCurrency = (amount: number, currency: string = 'AUD') => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  // Format date
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-AU', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Loading state
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Amazon Orders</h1>
        <p className="text-muted-foreground mt-4">Loading orders...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Amazon Orders</h1>
      <p className="text-muted-foreground mt-1">
        Import Amazon order CSVs and match them to bank expenses.
      </p>

      {/* Import Section */}
      <div className="bg-card border rounded-lg p-6 mt-6 space-y-4">
        <h2 className="text-lg font-semibold">Import Orders</h2>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">Amazon Order CSV</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground text-sm file:mr-3 file:px-3 file:py-1 file:border-0 file:rounded file:bg-secondary file:text-secondary-foreground file:text-sm file:font-medium file:cursor-pointer"
            />
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>

        {/* Import result */}
        {importResult && (
          <div className="p-3 rounded-md bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200 text-sm">
            Successfully imported {importResult.orders} order{importResult.orders !== 1 ? 's' : ''} with{' '}
            {importResult.items} item{importResult.items !== 1 ? 's' : ''}.
          </div>
        )}

        {/* Import error */}
        {importError && (
          <div className="p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200 text-sm">
            {importError}
          </div>
        )}

        {/* Matching controls */}
        <div className="border-t pt-4 mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRunMatching}
              disabled={matching || orders.length === 0}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {matching ? 'Running Matching...' : 'Run Matching'}
            </button>
            {orders.length === 0 && (
              <span className="text-sm text-muted-foreground">Import orders first to run matching.</span>
            )}
          </div>

          {/* Match error */}
          {matchError && (
            <div className="mt-3 p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200 text-sm">
              {matchError}
            </div>
          )}

          {/* Match results */}
          {matchResults && (
            <div className="mt-3">
              {matchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matches found.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Found {matchResults.length} match{matchResults.length !== 1 ? 'es' : ''}:
                  </p>
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {matchResults.map((mr) => (
                      <div
                        key={`${mr.amazon_order_id}-${mr.expense_id}`}
                        className="flex flex-wrap items-center gap-2 p-2 border rounded-md text-sm"
                      >
                        <span className="font-mono text-xs">{mr.order_id_text}</span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                            mr.confidence === 'high'
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                          }`}
                        >
                          {mr.confidence}
                        </span>
                        <span className="text-muted-foreground">
                          {mr.date_diff_days}d diff
                        </span>
                        <span className="text-muted-foreground">
                          {mr.amount_diff_pct.toFixed(1)}% amount diff
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="mt-4 p-3 rounded-md bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200 text-sm">
          {loadError}
          <button
            onClick={() => { setLoading(true); loadOrders(); }}
            className="ml-2 underline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mt-6 bg-muted rounded-lg p-1">
        {(['all', 'matched', 'unmatched'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              filter === tab
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            <span className="ml-1 text-xs text-muted-foreground">
              ({counts[tab]})
            </span>
          </button>
        ))}
      </div>

      {/* Orders list */}
      <div className="mt-4 space-y-3">
        {filteredOrders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {orders.length === 0
              ? 'No orders imported yet. Upload an Amazon CSV to get started.'
              : 'No orders match the selected filter.'}
          </p>
        ) : (
          filteredOrders.map((order) => {
            const isExpanded = expandedOrders.has(order.id);
            const isMatched = order.matched_expense_id !== null;
            const itemCount = order.items?.length ?? 0;

            return (
              <div key={order.id} className="bg-card border rounded-lg p-4">
                {/* Order header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Status indicator */}
                    {isMatched ? (
                      <span
                        className="mt-1 shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900"
                        title="Matched"
                      >
                        <svg
                          className="w-3 h-3 text-green-600 dark:text-green-300"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    ) : (
                      <span
                        className="mt-1.5 shrink-0 w-3 h-3 rounded-full bg-orange-400"
                        title="Unmatched"
                      />
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium">{order.order_id}</span>
                        <span className="text-sm text-muted-foreground">{formatDate(order.order_date)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        <span className="text-base font-semibold">
                          {formatCurrency(order.total_owed, order.currency)}
                        </span>
                        <span className="text-xs text-muted-foreground">{order.currency}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isMatched && (
                      <button
                        onClick={() => handleUnmatch(order.id)}
                        disabled={unmatchingId === order.id}
                        className="px-3 py-1.5 text-xs font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {unmatchingId === order.id ? 'Unmatching...' : 'Unmatch'}
                      </button>
                    )}
                    {itemCount > 0 && (
                      <button
                        onClick={() => toggleExpanded(order.id)}
                        className="px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-input rounded-md hover:bg-muted transition-colors"
                      >
                        {isExpanded ? 'Hide' : 'Show'} {itemCount} item{itemCount !== 1 ? 's' : ''}
                        <svg
                          className={`inline-block ml-1 w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>

                {/* Matched expense details */}
                {isMatched && order.matched_expense && (
                  <div className="mt-3 p-3 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                    <div className="flex items-center gap-2 mb-1">
                      <svg
                        className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
                      </svg>
                      <span className="text-sm font-medium text-green-800 dark:text-green-200">
                        Matched Expense
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Date: </span>
                        <span className="text-green-900 dark:text-green-100">
                          {formatDate(order.matched_expense.date)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Description: </span>
                        <span className="text-green-900 dark:text-green-100">
                          {order.matched_expense.description}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Amount: </span>
                        <span className="text-green-900 dark:text-green-100">
                          {formatCurrency(order.matched_expense.amount_aud, 'AUD')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Also support flat expense fields from API response */}
                {isMatched && !order.matched_expense && (order as any).expense_date && (
                  <div className="mt-3 p-3 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                    <div className="flex items-center gap-2 mb-1">
                      <svg
                        className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
                      </svg>
                      <span className="text-sm font-medium text-green-800 dark:text-green-200">
                        Matched Expense
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Date: </span>
                        <span className="text-green-900 dark:text-green-100">
                          {formatDate((order as any).expense_date)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Description: </span>
                        <span className="text-green-900 dark:text-green-100">
                          {(order as any).expense_description}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Amount: </span>
                        <span className="text-green-900 dark:text-green-100">
                          {formatCurrency((order as any).expense_amount_aud, 'AUD')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Expanded item list */}
                {isExpanded && order.items && order.items.length > 0 && (
                  <div className="mt-3 border-t pt-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Product</th>
                          <th className="pb-2 font-medium text-right w-16">Qty</th>
                          <th className="pb-2 font-medium text-right w-28">Unit Price</th>
                          <th className="pb-2 font-medium text-right w-28">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {order.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-2 pr-2">
                              <div className="font-medium">{item.product_name}</div>
                              {item.amazon_category && (
                                <div className="text-xs text-muted-foreground mt-0.5">
                                  {item.amazon_category}
                                </div>
                              )}
                              {item.asin && (
                                <div className="text-xs text-muted-foreground font-mono">
                                  ASIN: {item.asin}
                                </div>
                              )}
                            </td>
                            <td className="py-2 text-right tabular-nums">{item.quantity}</td>
                            <td className="py-2 text-right tabular-nums">
                              {formatCurrency(item.unit_price, order.currency)}
                            </td>
                            <td className="py-2 text-right tabular-nums font-medium">
                              {formatCurrency(item.item_subtotal, order.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Summary footer */}
      {orders.length > 0 && (
        <p className="text-center text-sm text-muted-foreground mt-6">
          {counts.matched} of {counts.all} order{counts.all !== 1 ? 's' : ''} matched to expenses.
          {counts.unmatched > 0 && ` ${counts.unmatched} still unmatched.`}
        </p>
      )}
    </div>
  );
}
