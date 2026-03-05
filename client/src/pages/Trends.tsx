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
  key: string;   // 'cat:1' or 'sub:5'
  name: string;
  type: 'category' | 'subcategory';
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

  // Load categories on mount; auto-select first 5 top-level categories
  useEffect(() => {
    categoriesApi.list().then((cats: any[]) => {
      const topLevel = cats as CategoryWithChildren[];
      setAllCategories(topLevel);
      const defaultItems = topLevel.slice(0, 5).map((c) => `cat:${c.id}`);
      setSelectedItems(new Set(defaultItems));
      setAppliedItems(defaultItems);
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
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
  const { chartData, chartSeries } = useMemo(() => {
    if (!trendsData) return { chartData: [], chartSeries: [] };

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

    return { chartData, chartSeries: series };
  }, [trendsData]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Trends</h1>

      {/* Date Range + Apply */}
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
              All
            </button>
            <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline">
              None
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
        <h2 className="text-lg font-semibold mb-1">Monthly Expenses by Category / Subcategory</h2>
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
    </div>
  );
}
