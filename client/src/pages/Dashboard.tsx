import { useState, useEffect, useMemo, useCallback } from 'react';
import { dashboard } from '@/api/client';
import type { DashboardSummary, CategoryBreakdown } from '@/types';
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
    </div>
  );
}

export default function Dashboard() {
  const defaults = getDefaultDateRange();
  const [fromMonth, setFromMonth] = useState(defaults.from);
  const [toMonth, setToMonth] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const handleApply = () => {
    setAppliedFrom(fromMonth);
    setAppliedTo(toMonth);
  };

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

  const pieData = useMemo(() => {
    return aggregatedCategories.map((cat) => ({
      ...cat,
      name: cat.category_name,
      value: cat.total_aud,
    }));
  }, [aggregatedCategories]);

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
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="bg-card border rounded-lg p-6">
              <p className="text-sm text-muted-foreground">Total Income</p>
              <p className="text-2xl font-bold text-green-600 mt-1">
                {formatCurrency(data.selected_month_total_income)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Selected month</p>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <p className="text-sm text-muted-foreground">Total Expenses</p>
              <p className="text-2xl font-bold text-red-500 mt-1">
                {formatCurrency(data.selected_month_total_expenses)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Selected month</p>
            </div>
            <div className="bg-card border rounded-lg p-6">
              <p className="text-sm text-muted-foreground">Savings</p>
              <p className={`text-2xl font-bold mt-1 ${data.selected_month_savings >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {data.selected_month_savings < 0 ? '-' : ''}{formatCurrency(data.selected_month_savings)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Selected month</p>
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
                  <Bar dataKey="total_income" name="Income" fill="#10B981" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="total_expenses" name="Expenses" fill="#F97316" radius={[2, 2, 0, 0]} />
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
            <h2 className="text-lg font-semibold mb-4">Category Breakdown</h2>
            {aggregatedCategories.length === 0 ? (
              <p className="text-muted-foreground text-sm">No category data available for the selected month.</p>
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
                        label={({ name, percent }: { name: string; percent: number }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={{ strokeWidth: 1 }}
                      >
                        {pieData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
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
                      {aggregatedCategories.map((cat, idx) => (
                        <tr key={cat.category_id} className="border-b last:border-b-0 hover:bg-muted/50">
                          <td className="py-2 pr-4">
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                              />
                              {cat.category_name}
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
                          {formatCurrency(aggregatedCategories.reduce((sum, c) => sum + c.total_aud, 0))}
                        </td>
                        <td className="text-right py-2 tabular-nums">
                          {aggregatedCategories.reduce((sum, c) => sum + c.percentage_of_income, 0).toFixed(1)}%
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
