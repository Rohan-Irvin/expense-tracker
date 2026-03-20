import { useState, useEffect, useMemo } from 'react';
import { categories as categoriesApi, dashboard } from '@/api/client';
import type { CategoryWithChildren } from '@/types';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const TREND_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
];

function formatMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(month, 10) - 1]} '${year.slice(2)}`;
}

function formatCurrency(value: number): string {
  return '$' + Math.abs(value).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function getDefaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const fromDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}`;
  return { from, to };
}

interface TrendSeries {
  key: string;   // 'cat:1', 'sub:5', or 'uncat:1'
  name: string;
  type: 'category' | 'subcategory' | 'uncategorized';
}

interface TrendsData {
  months: string[];
  series: TrendSeries[];
  data: { month: string; series_key: string; total_aud: number }[];
}

export default function Trends() {
  const defaults = getDefaultRange();
  const [fromMonth, setFromMonth] = useState(defaults.from);
  const [toMonth, setToMonth] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);
  const [appliedItems, setAppliedItems] = useState<string[]>([]);

  const [allCategories, setAllCategories] = useState<CategoryWithChildren[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set());

  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSubcategories, setShowSubcategories] = useState(true);

  // Load categories on mount; auto-select first 5 top-level categories + their subs
  useEffect(() => {
    categoriesApi.list().then((cats: any[]) => {
      const topLevel = cats as CategoryWithChildren[];
      setAllCategories(topLevel);
      const defaultKeys: string[] = [];
      for (const cat of topLevel.slice(0, 5)) {
        defaultKeys.push(`cat:${cat.id}`);
        for (const sub of cat.children) defaultKeys.push(`sub:${sub.id}`);
      }
      setSelectedItems(new Set(defaultKeys));
      setAppliedItems(defaultKeys);
    }).catch(console.error);
  }, []);

  // Fetch trends when applied values change
  useEffect(() => {
    if (appliedItems.length === 0) {
      setTrendsData(null);
      return;
    }
    setLoading(true);
    setError(null);
    dashboard
      .trends(appliedFrom, appliedTo, appliedItems)
      .then((result: any) => {
        setTrendsData(result as TrendsData);
      })
      .catch((err: any) => {
        setError(err.message || 'Failed to load trends data');
      })
      .finally(() => setLoading(false));
  }, [appliedFrom, appliedTo, appliedItems]);

  const handleApply = () => {
    setAppliedFrom(fromMonth);
    setAppliedTo(toMonth);
    setAppliedItems(Array.from(selectedItems));
  };

  const toggleItem = (key: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (key.startsWith('cat:')) {
        const catId = parseInt(key.slice(4), 10);
        const cat = allCategories.find((c) => c.id === catId);
        const subKeys = cat ? cat.children.map((s) => `sub:${s.id}`) : [];
        if (next.has(key)) {
          next.delete(key);
          subKeys.forEach((sk) => next.delete(sk));
        } else {
          next.add(key);
          subKeys.forEach((sk) => next.add(sk));
        }
      } else {
        if (next.has(key)) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const toggleExpand = (catId: number) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const selectAll = () => {
    const allKeys: string[] = [];
    for (const cat of allCategories) {
      allKeys.push(`cat:${cat.id}`);
      for (const sub of cat.children) {
        allKeys.push(`sub:${sub.id}`);
      }
    }
    setSelectedItems(new Set(allKeys));
  };

  const clearAll = () => setSelectedItems(new Set());

  // Build recharts-friendly data using series_key as dataKey
  const { chartData, chartSeries, tableSeries, totalSeries } = useMemo(() => {
    if (!trendsData) return { chartData: [], chartSeries: [], tableSeries: [], totalSeries: [] };

    const { months, series, data } = trendsData;

    // Build lookup: `month:series_key` → total_aud
    const lookup = new Map<string, number>();
    for (const row of data) {
      lookup.set(`${row.month}:${row.series_key}`, row.total_aud);
    }

    const chartData = months.map((month) => {
      const point: Record<string, any> = { month, label: formatMonth(month) };
      for (const s of series) {
        point[s.key] = lookup.get(`${month}:${s.key}`) ?? 0;
      }
      return point;
    });

    // Chart excludes uncat rows; also filters subcategories based on toggle
    const chartSeries = series.filter((s) =>
      s.type !== 'uncategorized' && (showSubcategories || s.type !== 'subcategory')
    );

    // Table hides subcategory rows (but keeps uncat rows) when toggle is off
    const visibleTableSeries = showSubcategories
      ? series
      : series.filter((s) => s.type !== 'subcategory');

    // Build sub→parent lookup to detect double-counting
    const subToParent = new Map<number, number>();
    for (const cat of allCategories) {
      for (const sub of cat.children) {
        subToParent.set(sub.id, cat.id);
      }
    }

    // When subcategories are visible, find which cat IDs have subs selected
    // (those cat rows would double-count if included in the total)
    const catIdsWithSubsInSeries = new Set<number>();
    if (showSubcategories) {
      for (const s of series) {
        if (s.type === 'subcategory') {
          const subId = parseInt(s.key.slice(4), 10);
          const parentId = subToParent.get(subId);
          if (parentId !== undefined && series.some((cs) => cs.key === `cat:${parentId}`)) {
            catIdsWithSubsInSeries.add(parentId);
          }
        }
      }
    }

    // totalSeries: used only for footer totals — avoids double-counting
    //   - Exclude cat:X when any sub for X is also in the series
    //   - Include uncat:X instead (covers the uncategorized portion of X)
    //   - When showSubcategories=false, only cat rows are used (subs filtered out)
    const totalSeries = series.filter((s) => {
      if (!showSubcategories && s.type === 'subcategory') return false;
      if (s.type === 'category') {
        const catId = parseInt(s.key.slice(4), 10);
        return !catIdsWithSubsInSeries.has(catId);
      }
      if (s.type === 'uncategorized') {
        const catId = parseInt(s.key.slice(6), 10);
        return catIdsWithSubsInSeries.has(catId);
      }
      return true; // subcategory rows always counted
    });

    return { chartData, chartSeries, tableSeries: visibleTableSeries, totalSeries };
  }, [trendsData, showSubcategories, allCategories]);

  // Export table data as CSV
  const handleExportCsv = () => {
    if (!trendsData || chartData.length === 0 || tableSeries.length === 0) return;
    const months = trendsData.months;
    const header = ['Category', 'Subcategory', ...months.map(formatMonth), 'Total'];
    const rows = tableSeries.map((s) => {
      const parts = s.name.split(' › ');
      const parentName = parts[0];
      const subName = parts.length > 1 ? parts[1] : '';
      const vals = months.map((m) => chartData.find((d) => d.month === m)?.[s.key] ?? 0);
      const total = vals.reduce((a: number, b: number) => a + b, 0);
      return [parentName, subName, ...vals.map((v: number) => v.toFixed(2)), total.toFixed(2)];
    });
    // Column totals — use totalSeries to avoid double-counting cat+sub rows
    const colTotals = months.map((m) =>
      totalSeries.reduce((sum, s) => sum + (chartData.find((d) => d.month === m)?.[s.key] ?? 0), 0)
    );
    const grandTotal = colTotals.reduce((a, b) => a + b, 0);
    rows.push(['Total', '', ...colTotals.map((v) => v.toFixed(2)), grandTotal.toFixed(2)]);

    const csvContent = [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trends_${appliedFrom}_${appliedTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Trends</h1>

      {/* Date Range + Apply */}
      <div className="flex flex-wrap items-end gap-3 mt-6">
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
        {/* Year quick-select */}
        {[new Date().getFullYear() - 1, new Date().getFullYear()].map((yr) => (
          <button
            key={yr}
            onClick={() => { setFromMonth(`${yr}-01`); setToMonth(`${yr}-12`); }}
            className="px-3 py-2 text-sm border border-input rounded-md hover:bg-muted transition-colors"
          >
            {yr}
          </button>
        ))}
        <button
          onClick={handleApply}
          disabled={loading || selectedItems.size === 0}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {/* Category + Subcategory Selection */}
      <div className="bg-card border rounded-lg p-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Categories &amp; Subcategories</h2>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs text-muted-foreground hover:text-foreground underline">
              Select All
            </button>
            <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline">
              Clear Selection
            </button>
          </div>
        </div>

        {allCategories.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading categories…</p>
        )}

        <div className="space-y-0.5">
          {allCategories.map((cat) => {
            const catKey = `cat:${cat.id}`;
            const isCatSelected = selectedItems.has(catKey);
            const isExpanded = expandedCats.has(cat.id);
            const hasChildren = cat.children.length > 0;

            return (
              <div key={cat.id}>
                {/* Parent category row */}
                <div className="flex items-center gap-1">
                  {/* Expand/collapse toggle */}
                  <button
                    onClick={() => hasChildren && toggleExpand(cat.id)}
                    className={`w-5 h-5 flex items-center justify-center text-xs text-muted-foreground transition-colors ${
                      hasChildren ? 'hover:text-foreground cursor-pointer' : 'opacity-0 pointer-events-none'
                    }`}
                    tabIndex={hasChildren ? 0 : -1}
                    aria-label={isExpanded ? 'Collapse subcategories' : 'Expand subcategories'}
                  >
                    {isExpanded ? '▾' : '▸'}
                  </button>
                  {/* Category toggle */}
                  <button
                    onClick={() => toggleItem(catKey)}
                    className={`flex-1 text-left px-2 py-1.5 text-sm rounded transition-colors ${
                      isCatSelected
                        ? 'bg-primary/15 text-primary font-medium'
                        : 'hover:bg-muted/60 text-foreground'
                    }`}
                  >
                    {cat.name}
                    {hasChildren && (
                      <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                        ({cat.children.length})
                      </span>
                    )}
                  </button>
                </div>

                {/* Subcategory rows (when expanded) */}
                {isExpanded && hasChildren && (
                  <div className="ml-6 space-y-0.5 mb-1">
                    {cat.children.map((sub) => {
                      const subKey = `sub:${sub.id}`;
                      const isSubSelected = selectedItems.has(subKey);
                      return (
                        <button
                          key={sub.id}
                          onClick={() => toggleItem(subKey)}
                          className={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                            isSubSelected
                              ? 'bg-primary/15 text-primary font-medium'
                              : 'hover:bg-muted/60 text-muted-foreground'
                          }`}
                        >
                          {sub.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedItems.size === 0 && allCategories.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">Select at least one item, then click Apply.</p>
        )}
      </div>

      {/* Chart */}
      <div className="bg-card border rounded-lg p-6 mt-6">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-semibold">Monthly Expenses by Category / Subcategory</h2>
          <button
            onClick={() => setShowSubcategories((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
              showSubcategories
                ? 'bg-primary/10 border-primary/30 text-primary font-medium'
                : 'border-input text-muted-foreground hover:bg-muted'
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${showSubcategories ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
            Subcategories
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Solid lines = categories · Dashed lines = subcategories
        </p>

        {error && <p className="text-destructive text-sm">{error}</p>}
        {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

        {!loading && !error && appliedItems.length === 0 && (
          <p className="text-muted-foreground text-sm">Select at least one category and click Apply.</p>
        )}

        {!loading && !error && appliedItems.length > 0 && chartData.length === 0 && (
          <p className="text-muted-foreground text-sm">No data for the selected categories and date range.</p>
        )}

        {!loading && !error && chartData.length > 0 && chartSeries.length > 0 && (
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                width={60}
              />
              <Tooltip
                formatter={(value: number | undefined, name: string | undefined) => [formatCurrency(value ?? 0), name ?? '']}
                labelClassName="font-medium"
              />
              <Legend />
              {chartSeries.map((s, idx) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={TREND_COLORS[idx % TREND_COLORS.length]}
                  strokeWidth={s.type === 'subcategory' ? 1.5 : 2}
                  strokeDasharray={s.type === 'subcategory' ? '5 3' : undefined}
                  dot={{ r: s.type === 'subcategory' ? 2 : 3, fill: TREND_COLORS[idx % TREND_COLORS.length] }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Data Table */}
      {!loading && !error && chartData.length > 0 && tableSeries.length > 0 && (
        <div className="bg-card border rounded-lg mt-6">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Monthly Data</h2>
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-input rounded-md hover:bg-muted transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/40 min-w-[160px]">
                    Category
                  </th>
                  {trendsData!.months.map((m) => (
                    <th key={m} className="text-right px-3 py-2.5 font-medium text-muted-foreground whitespace-nowrap">
                      {formatMonth(m)}
                    </th>
                  ))}
                  <th className="text-right px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap border-l">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableSeries.map((s, idx) => {
                  const isUncat = s.type === 'uncategorized';
                  // Color: uncat rows use their parent cat's chart color; others use their own chart index
                  const chartKey = isUncat ? s.key.replace('uncat:', 'cat:') : s.key;
                  const chartIdx = chartSeries.findIndex((cs) => cs.key === chartKey);
                  const color = TREND_COLORS[(chartIdx >= 0 ? chartIdx : idx) % TREND_COLORS.length];
                  const vals = trendsData!.months.map(
                    (m) => chartData.find((d) => d.month === m)?.[s.key] ?? 0
                  );
                  const rowTotal = vals.reduce((a: number, b: number) => a + b, 0);
                  return (
                    <tr
                      key={s.key}
                      className={`border-b hover:bg-muted/30 transition-colors ${isUncat ? 'bg-muted/10' : ''}`}
                    >
                      <td className={`px-4 py-2 sticky left-0 hover:bg-muted/30 ${isUncat ? 'bg-muted/10' : 'bg-card'}`}>
                        <span className="flex items-center gap-2">
                          {isUncat ? (
                            <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 border border-dashed"
                              style={{ borderColor: color }} />
                          ) : (
                            <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: color }} />
                          )}
                          <span className={
                            isUncat
                              ? 'text-muted-foreground italic ml-2 text-xs'
                              : s.type === 'subcategory'
                              ? 'text-muted-foreground text-xs'
                              : 'font-medium'
                          }>
                            {s.name}
                          </span>
                        </span>
                      </td>
                      {vals.map((v: number, i: number) => (
                        <td key={i} className={`text-right px-3 py-2 tabular-nums ${v === 0 ? 'text-muted-foreground/40' : isUncat ? 'text-muted-foreground' : ''}`}>
                          {v === 0 ? '—' : formatCurrency(v)}
                        </td>
                      ))}
                      <td className={`text-right px-4 py-2 tabular-nums border-l ${isUncat ? 'text-muted-foreground' : 'font-medium'}`}>
                        {formatCurrency(rowTotal)}
                      </td>
                    </tr>
                  );
                })}
                {/* Column totals — uses totalSeries to avoid double-counting cat+sub rows */}
                <tr className="bg-muted/40 font-semibold border-t-2">
                  <td className="px-4 py-2.5 sticky left-0 bg-muted/40">Total</td>
                  {trendsData!.months.map((m) => {
                    const colTotal = totalSeries.reduce(
                      (sum, s) => sum + (chartData.find((d) => d.month === m)?.[s.key] ?? 0),
                      0
                    );
                    return (
                      <td key={m} className="text-right px-3 py-2.5 tabular-nums">
                        {formatCurrency(colTotal)}
                      </td>
                    );
                  })}
                  <td className="text-right px-4 py-2.5 tabular-nums border-l">
                    {formatCurrency(
                      totalSeries.reduce(
                        (sum, s) =>
                          sum + trendsData!.months.reduce(
                            (msum, m) => msum + (chartData.find((d) => d.month === m)?.[s.key] ?? 0),
                            0
                          ),
                        0
                      )
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
