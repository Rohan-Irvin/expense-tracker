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

interface TrendsData {
  months: string[];
  categories: { id: number; name: string }[];
  data: { month: string; category_id: number; total_aud: number }[];
}

export default function Trends() {
  const defaults = getDefaultRange();
  const [fromMonth, setFromMonth] = useState(defaults.from);
  const [toMonth, setToMonth] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);
  const [appliedCatIds, setAppliedCatIds] = useState<number[]>([]);

  const [allCategories, setAllCategories] = useState<CategoryWithChildren[]>([]);
  const [selectedCatIds, setSelectedCatIds] = useState<Set<number>>(new Set());

  const [trendsData, setTrendsData] = useState<TrendsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load categories on mount; auto-select first 5
  useEffect(() => {
    categoriesApi.list().then((cats: any[]) => {
      const topLevel = cats as CategoryWithChildren[];
      setAllCategories(topLevel);
      const defaultIds = topLevel.slice(0, 5).map((c) => c.id);
      setSelectedCatIds(new Set(defaultIds));
      setAppliedCatIds(defaultIds);
    }).catch(console.error);
  }, []);

  // Fetch trends when applied values change
  useEffect(() => {
    if (appliedCatIds.length === 0) {
      setTrendsData(null);
      return;
    }
    setLoading(true);
    setError(null);
    dashboard
      .trends(appliedFrom, appliedTo, appliedCatIds)
      .then((result: any) => {
        setTrendsData(result as TrendsData);
      })
      .catch((err: any) => {
        setError(err.message || 'Failed to load trends data');
      })
      .finally(() => setLoading(false));
  }, [appliedFrom, appliedTo, appliedCatIds]);

  const handleApply = () => {
    setAppliedFrom(fromMonth);
    setAppliedTo(toMonth);
    setAppliedCatIds(Array.from(selectedCatIds));
  };

  const toggleCategory = (id: number) => {
    setSelectedCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedCatIds(new Set(allCategories.map((c) => c.id)));
  const clearAll = () => setSelectedCatIds(new Set());

  // Build recharts-friendly data: [{month, label, 'Food': 500, 'Transport': 200}, ...]
  const { chartData, chartCategories } = useMemo(() => {
    if (!trendsData) return { chartData: [], chartCategories: [] };

    const { months, categories, data } = trendsData;

    // Build lookup: `month:categoryId` → total_aud
    const lookup = new Map<string, number>();
    for (const row of data) {
      lookup.set(`${row.month}:${row.category_id}`, row.total_aud);
    }

    const chartData = months.map((month) => {
      const point: Record<string, any> = { month, label: formatMonth(month) };
      for (const cat of categories) {
        point[cat.name] = lookup.get(`${month}:${cat.id}`) ?? 0;
      }
      return point;
    });

    return { chartData, chartCategories: categories };
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
          disabled={loading || selectedCatIds.size === 0}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Apply'}
        </button>
      </div>

      {/* Category Selection */}
      <div className="bg-card border rounded-lg p-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium">Categories</h2>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              All
            </button>
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              None
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {allCategories.length === 0 && (
            <p className="text-sm text-muted-foreground">Loading categories…</p>
          )}
          {allCategories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => toggleCategory(cat.id)}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                selectedCatIds.has(cat.id)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-input hover:bg-muted'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
        {selectedCatIds.size === 0 && allCategories.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">Select at least one category, then click Apply.</p>
        )}
      </div>

      {/* Chart */}
      <div className="bg-card border rounded-lg p-6 mt-6">
        <h2 className="text-lg font-semibold mb-4">Monthly Expenses by Category</h2>

        {error && <p className="text-destructive text-sm">{error}</p>}
        {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

        {!loading && !error && appliedCatIds.length === 0 && (
          <p className="text-muted-foreground text-sm">Select at least one category and click Apply.</p>
        )}

        {!loading && !error && appliedCatIds.length > 0 && chartData.length === 0 && (
          <p className="text-muted-foreground text-sm">No data for the selected categories and date range.</p>
        )}

        {!loading && !error && chartData.length > 0 && chartCategories.length > 0 && (
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
              {chartCategories.map((cat, idx) => (
                <Line
                  key={cat.id}
                  type="monotone"
                  dataKey={cat.name}
                  stroke={TREND_COLORS[idx % TREND_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: TREND_COLORS[idx % TREND_COLORS.length] }}
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
