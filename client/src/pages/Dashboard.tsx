import { useState, useEffect, useMemo, useCallback } from 'react';
import { dashboard, expenses as expensesApi, categories as categoriesApi } from '@/api/client';
import type { DashboardSummary, CategoryBreakdown, CategoryWithChildren } from '@/types';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, Line,
} from 'recharts';

const PIE_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIndex = parseInt(month, 10) - 1;
  const shortYear = year.slice(2);
  return `${monthNames[monthIndex]} '${shortYear}`;
}

function formatCurrency(value: number): string {
  return '$' + Math.abs(value).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fromDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
  return { from, to };
}

interface AggregatedCategory {
  category_id: number;
  category_name: string;
  total_aud: number;
  percentage_of_income: number;
}

function aggregateCategories(breakdown: CategoryBreakdown[]): AggregatedCategory[] {
  const map = new Map<number, AggregatedCategory>();
  for (const row of breakdown) {
    const existing = map.get(row.category_id);
    if (existing) {
      existing.total_aud += row.total_aud;
      existing.percentage_of_income += row.percentage_of_income;
    } else {
      map.set(row.category_id, {
        category_id: row.category_id,
        category_name: row.category_name,
        total_aud: row.total_aud,
        percentage_of_income: row.percentage_of_income,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.total_aud - a.total_aud);
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function TrendTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border rounded-lg p-3 shadow-lg text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry, idx) => (
        <p key={idx} style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

interface PieTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: AggregatedCategory }>;
}

function CategoryTooltip({ active, payload }: PieTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0];
  return (
    <div className="bg-card border rounded-lg p-3 shadow-lg text-sm">
      <p className="font-medium">{data.name}</p>
      <p>{formatCurrency(data.value)}</p>
      <p className="text-muted-foreground">{data.payload.percentage_of_income.toFixed(1)}% of income</p>
      <p className="text-xs text-muted-foreground mt-1">Click to drill down</p>
    </div>
  );
}

type SortKey = 'date' | 'amount_aud' | 'description';
type SortDir = 'asc' | 'desc';

export default function Dashboard() {
  const defaults = getDefaultDateRange();
  const [fromMonth, setFromMonth] = useState(defaults.from);
  const [toMonth, setToMonth] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Bar chart click state (month filter for category breakdown)
  // -------------------------------------------------------------------------
  const [clickedBarMonth, setClickedBarMonth] = useState<string | null>(null);
  const [barMonthCats, setBarMonthCats] = useState<AggregatedCategory[] | null>(null);
  const [barMonthLoading, setBarMonthLoading] = useState(false);

  // -------------------------------------------------------------------------
  // Drilldown state
  // -------------------------------------------------------------------------
  const [allCategories, setAllCategories] = useState<CategoryWithChildren[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | null>(null);
  const [drilldownExpenses, setDrilldownExpenses] = useState<any[]>([]);
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState<string | null>(null);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Inline edit
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [editCatId, setEditCatId] = useState<number>(0);
  const [editSubcatId, setEditSubcatId] = useState<number>(0);
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // -------------------------------------------------------------------------
  // Load categories for edit dropdowns (once on mount)
  // -------------------------------------------------------------------------
  useEffect(() => {
    categoriesApi
      .list()
      .then((cats: any[]) => setAllCategories(cats as CategoryWithChildren[]))
      .catch(console.error);
  }, []);

  // -------------------------------------------------------------------------
  // Dashboard summary data
  // -------------------------------------------------------------------------
  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await dashboard.summary(from, to) as DashboardSummary;
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(appliedFrom, appliedTo);
  }, [appliedFrom, appliedTo, fetchData]);

  // -------------------------------------------------------------------------
  // Drilldown: fetch expenses when a category is selected or range changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (selectedCatId === null) {
      setDrilldownExpenses([]);
      return;
    }
    setDrilldownLoading(true);
    setDrilldownError(null);
    setEditingExpenseId(null);
    setConfirmDeleteId(null);

    // If a bar month is selected, scope drilldown to that month; else use full applied range
    const drillFrom = clickedBarMonth ?? appliedFrom;
    const drillTo = clickedBarMonth ?? appliedTo;

    const dateFrom = `${drillFrom}-01`;
    const toDate = new Date(drillTo + '-01');
    toDate.setMonth(toDate.getMonth() + 1);
    const dateTo = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-01`;

    expensesApi
      .list({
        date_from: dateFrom,
        date_to: dateTo,
        category_id: String(selectedCatId),
        statuses: 'approved,skipped',
        limit: '1000',
      })
      .then((result: any) => {
        setDrilldownExpenses(result.expenses || []);
        setDrilldownLoading(false);
      })
      .catch((err: any) => {
        setDrilldownError(err.message || 'Failed to load expenses');
        setDrilldownLoading(false);
      });
  }, [selectedCatId, appliedFrom, appliedTo, clickedBarMonth]);

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------
  const handleApply = () => {
    setAppliedFrom(fromMonth);
    setAppliedTo(toMonth);
    setSelectedCatId(null); // clear drilldown when range changes
    setClickedBarMonth(null);
    setBarMonthCats(null);
  };

  const handleBarClick = useCallback((barData: any) => {
    if (!barData || !barData.month) return;
    const month = barData.month as string;
    if (clickedBarMonth === month) {
      // Toggle off
      setClickedBarMonth(null);
      setBarMonthCats(null);
      return;
    }
    setClickedBarMonth(month);
    setSelectedCatId(null); // clear category drilldown
    setBarMonthLoading(true);
    dashboard.summary(month, month).then((result: any) => {
      setBarMonthCats(aggregateCategories((result as DashboardSummary).category_breakdown));
    }).catch(console.error).finally(() => setBarMonthLoading(false));
  }, [clickedBarMonth]);

  const handleCatSelect = useCallback((catId: number) => {
    setSelectedCatId((prev) => (prev === catId ? null : catId));
    setSortKey('date');
    setSortDir('desc');
    setEditingExpenseId(null);
    setConfirmDeleteId(null);
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const startEdit = (expense: any) => {
    setEditingExpenseId(expense.id);
    setEditCatId(expense.category_id ?? 0);
    setEditSubcatId(expense.subcategory_id ?? 0);
    setConfirmDeleteId(null);
  };

  const saveEdit = async () => {
    if (!editingExpenseId) return;
    setEditSaving(true);
    try {
      await expensesApi.updateCategory(editingExpenseId, {
        category_id: editCatId || null,
        subcategory_id: editSubcatId || null,
      });
      if (editCatId !== selectedCatId) {
        // Category changed — expense moves out of this drilldown
        setDrilldownExpenses((prev) => prev.filter((e) => e.id !== editingExpenseId));
      } else {
        // Same category — update subcategory in place
        const newSubcatName =
          allCategories.find((c) => c.id === editCatId)?.children.find((s) => s.id === editSubcatId)?.name ?? null;
        setDrilldownExpenses((prev) =>
          prev.map((e) =>
            e.id === editingExpenseId
              ? { ...e, subcategory_id: editSubcatId || null, subcategory_name: editSubcatId ? newSubcatName : null }
              : e
          )
        );
      }
      setEditingExpenseId(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    try {
      await expensesApi.delete(id);
      setDrilldownExpenses((prev) => prev.filter((e) => e.id !== id));
      setConfirmDeleteId(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  // -------------------------------------------------------------------------
  // Derived / memoised values
  // -------------------------------------------------------------------------
  const trendData = useMemo(() => {
    if (!data) return [];
    return data.monthly_trend.map((point) => ({
      ...point,
      label: formatMonth(point.month),
    }));
  }, [data]);

  const aggregatedCategories = useMemo(() => {
    if (!data) return [];
    return aggregateCategories(data.category_breakdown);
  }, [data]);

  // When a bar month is selected, show that month's breakdown; else show full period
  const displayCategories = barMonthCats ?? aggregatedCategories;

  const pieData = useMemo(() => {
    return displayCategories.map((cat) => ({
      ...cat,
      name: cat.category_name,
      value: cat.total_aud,
    }));
  }, [displayCategories]);

  const sortedDrilldown = useMemo(() => {
    return [...drilldownExpenses].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortKey === 'amount_aud') cmp = a.amount_aud - b.amount_aud;
      else cmp = (a.description || '').localeCompare(b.description || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [drilldownExpenses, sortKey, sortDir]);

  const editSubcatOptions = useMemo(() => {
    if (!editCatId) return [];
    return allCategories.find((c) => c.id === editCatId)?.children ?? [];
  }, [editCatId, allCategories]);

  const selectedCatName = useMemo(
    () =>
      selectedCatId !== null
        ? displayCategories.find((c) => c.category_id === selectedCatId)?.category_name ?? 'Category'
        : null,
    [selectedCatId, displayCategories]
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading && !data) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground mt-4">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Date Range Selector */}
      <div className="flex items-end gap-3 mt-6">
        <div>
          <label className="block text-sm font-medium mb-1">From</label>
          <input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            className="px-3 py-2 text-sm border border-input rounded-md bg-background"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">To</label>
          <input
            type="month"
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            className="px-3 py-2 text-sm border border-input rounded-md bg-background"
          />
        </div>
        <button
          onClick={handleApply}
          disabled={loading}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Apply'}
        </button>
      </div>

      {error && (
        <p className="text-destructive text-sm mt-4">{error}</p>
      )}

      {data && (
        <>
          {/* Summary Cards — period totals for the full selected range */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="bg-card border rounded-lg p-6">
              <p className="text-sm text-muted-foreground">Total Income</p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {formatCurrency(data.selected_month_total_income)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatMonth(appliedFrom)} – {formatMonth(appliedTo)}
              </p>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <p className="text-sm text-muted-foreground">Total Expenses</p>
              <p className="text-2xl font-bold text-red-500 mt-1">
                {formatCurrency(data.selected_month_total_expenses)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatMonth(appliedFrom)} – {formatMonth(appliedTo)}
              </p>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <p className="text-sm text-muted-foreground">Savings</p>
              <p className={`text-2xl font-bold mt-1 ${data.selected_month_savings >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {data.selected_month_savings < 0 ? '-' : ''}{formatCurrency(data.selected_month_savings)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatMonth(appliedFrom)} – {formatMonth(appliedTo)}
              </p>
            </div>
          </div>

          {/* Monthly Trend Chart */}
          <div className="bg-card border rounded-lg p-6 mt-6">
            <h2 className="text-lg font-semibold mb-4">Monthly Trend</h2>
            {trendData.length === 0 ? (
              <p className="text-muted-foreground text-sm">No trend data available for the selected range.</p>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<TrendTooltip />} />
                  <Legend />
                  <Bar
                    dataKey="total_income"
                    name="Income"
                    radius={[2, 2, 0, 0]}
                    onClick={handleBarClick}
                    style={{ cursor: 'pointer' }}
                  >
                    {trendData.map((entry: any, idx: number) => (
                      <Cell
                        key={idx}
                        fill={clickedBarMonth === null || clickedBarMonth === entry.month ? '#10B981' : '#10B98155'}
                      />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="total_expenses"
                    name="Expenses"
                    radius={[2, 2, 0, 0]}
                    onClick={handleBarClick}
                    style={{ cursor: 'pointer' }}
                  >
                    {trendData.map((entry: any, idx: number) => (
                      <Cell
                        key={idx}
                        fill={clickedBarMonth === null || clickedBarMonth === entry.month ? '#F97316' : '#F9731655'}
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="savings"
                    name="Savings"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#3B82F6' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Category Breakdown */}
          <div className="bg-card border rounded-lg p-6 mt-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-lg font-semibold">Category Breakdown</h2>
              {clickedBarMonth && (
                <button
                  onClick={() => { setClickedBarMonth(null); setBarMonthCats(null); setSelectedCatId(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
                >
                  ✕ Show full period
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              {clickedBarMonth
                ? `${formatMonth(clickedBarMonth)} · Click a category to drill down · Click bar again to deselect`
                : `${formatMonth(appliedFrom)} – ${formatMonth(appliedTo)} · Click a bar or category to drill down`}
              {barMonthLoading && ' · Loading…'}
            </p>
            {displayCategories.length === 0 ? (
              <p className="text-muted-foreground text-sm">No category data available for the selected range.</p>
            ) : (
              <div className="grid grid-cols-2 gap-6">
                {/* Pie Chart */}
                <div>
                  <ResponsiveContainer width="100%" height={350}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={130}
                        innerRadius={60}
                        paddingAngle={2}
                        onClick={(sliceData: any) => {
                          if (sliceData && sliceData.category_id !== undefined) {
                            handleCatSelect(sliceData.category_id);
                          }
                        }}
                        style={{ cursor: 'pointer' }}
                        label={({ name, percent }: { name?: string; percent?: number }) =>
                          `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                        }
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {pieData.map((entry, idx) => (
                          <Cell
                            key={idx}
                            fill={PIE_COLORS[idx % PIE_COLORS.length]}
                            opacity={
                              selectedCatId === null || selectedCatId === entry.category_id ? 1 : 0.35
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<CategoryTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Category Table */}
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Category</th>
                        <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Amount</th>
                        <th className="text-right py-2 font-medium text-muted-foreground">% of Income</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayCategories.map((cat, idx) => (
                        <tr
                          key={cat.category_id}
                          onClick={() => handleCatSelect(cat.category_id)}
                          className={`border-b last:border-b-0 cursor-pointer transition-colors ${
                            selectedCatId === cat.category_id
                              ? 'bg-primary/10 hover:bg-primary/15'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                              />
                              {cat.category_name}
                              {selectedCatId === cat.category_id && (
                                <span className="ml-1 text-xs text-primary font-medium">▼</span>
                              )}
                            </span>
                          </td>
                          <td className="text-right py-2 pr-4 tabular-nums">
                            {formatCurrency(cat.total_aud)}
                          </td>
                          <td className="text-right py-2 tabular-nums">
                            {cat.percentage_of_income.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t font-medium">
                        <td className="py-2 pr-4">Total</td>
                        <td className="text-right py-2 pr-4 tabular-nums">
                          {formatCurrency(displayCategories.reduce((sum, c) => sum + c.total_aud, 0))}
                        </td>
                        <td className="text-right py-2 tabular-nums">
                          {displayCategories.reduce((sum, c) => sum + c.percentage_of_income, 0).toFixed(1)}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Drilldown Section */}
          {selectedCatId !== null && (
            <div className="bg-card border rounded-lg p-6 mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{selectedCatName}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {clickedBarMonth
                      ? formatMonth(clickedBarMonth)
                      : `${formatMonth(appliedFrom)} – ${formatMonth(appliedTo)}`}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedCatId(null)}
                  className="text-sm text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
                >
                  ✕ Close
                </button>
              </div>

              {drilldownLoading ? (
                <p className="text-muted-foreground text-sm">Loading expenses…</p>
              ) : drilldownError ? (
                <p className="text-destructive text-sm">{drilldownError}</p>
              ) : sortedDrilldown.length === 0 ? (
                <p className="text-muted-foreground text-sm">No expenses found for this category in the selected range.</p>
              ) : (
                <>
                  {/* Sort controls + summary */}
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    <span className="text-xs text-muted-foreground">Sort:</span>
                    {(['date', 'amount_aud', 'description'] as SortKey[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => handleSort(key)}
                        className={`px-2.5 py-1 rounded border text-xs font-medium transition-colors ${
                          sortKey === key
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-input hover:bg-muted'
                        }`}
                      >
                        {key === 'date' ? 'Date' : key === 'amount_aud' ? 'Amount' : 'Description'}
                        {sortKey === key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
                      </button>
                    ))}
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {sortedDrilldown.length} expense{sortedDrilldown.length !== 1 ? 's' : ''} ·{' '}
                      <span className="font-medium text-foreground">
                        {formatCurrency(sortedDrilldown.reduce((s, e) => s + e.amount_aud, 0))}
                      </span>{' '}
                      total
                    </span>
                  </div>

                  {/* Expense table */}
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-3 font-medium text-muted-foreground w-28">Date</th>
                          <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Description</th>
                          <th className="text-right py-2 pr-3 font-medium text-muted-foreground w-28">Amount</th>
                          <th className="text-left py-2 pr-3 font-medium text-muted-foreground w-40">Subcategory</th>
                          <th className="text-right py-2 font-medium text-muted-foreground w-36">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDrilldown.map((expense) => {
                          const isEditing = editingExpenseId === expense.id;

                          if (isEditing) {
                            return (
                              <tr key={expense.id} className="border-b bg-muted/30">
                                <td className="py-2 pr-3 tabular-nums text-muted-foreground text-xs">
                                  {expense.date}
                                </td>
                                <td className="py-2 pr-3 text-muted-foreground">{expense.description}</td>
                                <td className="text-right py-2 pr-3 tabular-nums font-medium">
                                  {formatCurrency(expense.amount_aud)}
                                </td>
                                <td className="py-2 pr-3">
                                  <div className="flex flex-col gap-1">
                                    <select
                                      value={editCatId}
                                      onChange={(e) => {
                                        setEditCatId(parseInt(e.target.value, 10));
                                        setEditSubcatId(0);
                                      }}
                                      className="text-xs border border-input rounded px-1.5 py-1 bg-background w-full"
                                    >
                                      <option value={0}>No category</option>
                                      {allCategories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
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
                                        <option key={s.id} value={s.id}>
                                          {s.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </td>
                                <td className="text-right py-2">
                                  <div className="flex gap-1 justify-end">
                                    <button
                                      onClick={saveEdit}
                                      disabled={editSaving}
                                      className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
                                    >
                                      {editSaving ? 'Saving…' : 'Save'}
                                    </button>
                                    <button
                                      onClick={() => setEditingExpenseId(null)}
                                      className="px-2 py-1 text-xs border border-input rounded hover:bg-muted"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }

                          return (
                            <tr key={expense.id} className="border-b last:border-b-0 hover:bg-muted/50">
                              <td className="py-2 pr-3 tabular-nums text-muted-foreground text-xs">
                                {expense.date}
                              </td>
                              <td className="py-2 pr-3">{expense.description}</td>
                              <td className="text-right py-2 pr-3 tabular-nums font-medium">
                                {formatCurrency(expense.amount_aud)}
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground text-xs">
                                {expense.subcategory_name ?? '—'}
                              </td>
                              <td className="text-right py-2">
                                <div className="flex gap-1 justify-end">
                                  <button
                                    onClick={() => startEdit(expense)}
                                    className="px-2 py-1 text-xs border border-input rounded hover:bg-muted"
                                  >
                                    Edit
                                  </button>
                                  {confirmDeleteId === expense.id ? (
                                    <>
                                      <button
                                        onClick={() => handleDelete(expense.id)}
                                        className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
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
                                    <button
                                      onClick={() => handleDelete(expense.id)}
                                      className="px-2 py-1 text-xs border border-input rounded hover:bg-muted text-destructive hover:bg-destructive/10"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
