import { useState, useEffect, useMemo } from 'react';
import type { ExpenseWithSuggestion, CategoryWithChildren, SplitRow, AmazonOrderItem } from '@/types';

interface Props {
  expense: ExpenseWithSuggestion;
  categories: CategoryWithChildren[];
  amazonItems?: AmazonOrderItem[];
  onSplit: (rows: SplitRow[]) => void;
  onClose: () => void;
}

interface LocalRow {
  id: number;
  description: string;
  amount: string;
  category_id: number;
  subcategory_id: number;
}

let nextRowId = 1;

function formatCurrency(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export default function SplitDialog({ expense, categories, amazonItems, onSplit, onClose }: Props) {
  const [rows, setRows] = useState<LocalRow[]>([]);

  // Initialize rows
  useEffect(() => {
    if (amazonItems && amazonItems.length > 0) {
      // Pre-fill from Amazon items
      const amazonRows: LocalRow[] = amazonItems.map((item) => ({
        id: nextRowId++,
        description: item.product_name,
        amount: item.item_subtotal.toFixed(2),
        category_id: item.suggested_category_id ?? 0,
        subcategory_id: item.suggested_subcategory_id ?? 0,
      }));
      setRows(amazonRows);
    } else {
      // Start with two empty rows
      setRows([
        { id: nextRowId++, description: '', amount: '', category_id: 0, subcategory_id: 0 },
        { id: nextRowId++, description: '', amount: '', category_id: 0, subcategory_id: 0 },
      ]);
    }
  }, [amazonItems]);

  const parentAmount = expense.amount_aud;

  // Calculate allocated total
  const allocated = useMemo(() => {
    return rows.reduce((sum, row) => {
      const val = parseFloat(row.amount);
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
  }, [rows]);

  const remaining = parentAmount - allocated;
  const isBalanced = Math.abs(remaining) < 0.01;
  const isOver = allocated > parentAmount + 0.01;

  const updateRow = (id: number, field: keyof LocalRow, value: string | number) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const updated = { ...row, [field]: value };
        // Reset subcategory if category changes
        if (field === 'category_id') {
          const newParent = categories.find((c) => c.id === Number(value));
          const childIds = newParent?.children.map((c) => c.id) ?? [];
          if (!childIds.includes(row.subcategory_id)) {
            updated.subcategory_id = 0;
          }
        }
        return updated;
      })
    );
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { id: nextRowId++, description: '', amount: '', category_id: 0, subcategory_id: 0 },
    ]);
  };

  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const handleConfirm = () => {
    const splitRows: SplitRow[] = rows.map((row) => ({
      description: row.description || expense.description,
      amount_aud: parseFloat(row.amount) || 0,
      category_id: row.category_id || null,
      subcategory_id: row.subcategory_id || null,
    }));
    onSplit(splitRows);
  };

  // Get subcategories for a given category ID
  const getSubcategories = (catId: number) => {
    const parent = categories.find((c) => c.id === catId);
    return parent?.children ?? [];
  };

  // Determine the color for the allocated total
  const allocatedColor = isBalanced
    ? 'text-green-600'
    : isOver
      ? 'text-red-600'
      : 'text-yellow-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b shrink-0">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Split Transaction</h2>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-1"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {expense.description}
          </p>
          <p className="text-sm font-medium mt-1">
            Total: {formatCurrency(parentAmount)}
          </p>
        </div>

        {/* Scrollable rows area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {rows.map((row, index) => {
            const subs = getSubcategories(row.category_id);
            return (
              <div
                key={row.id}
                className="flex gap-2 items-start p-3 bg-muted/30 rounded-lg border"
              >
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    {/* Row number */}
                    <span className="text-xs text-muted-foreground mt-2 w-5 shrink-0">
                      {index + 1}.
                    </span>
                    {/* Description */}
                    <div className="flex-1">
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) => updateRow(row.id, 'description', e.target.value)}
                        placeholder="Description"
                        className="w-full px-2 py-1.5 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    {/* Amount */}
                    <div className="w-28 shrink-0">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.amount}
                        onChange={(e) => updateRow(row.id, 'amount', e.target.value)}
                        placeholder="0.00"
                        className="w-full px-2 py-1.5 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-right"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 ml-7">
                    {/* Category */}
                    <select
                      value={row.category_id}
                      onChange={(e) => updateRow(row.id, 'category_id', Number(e.target.value))}
                      className="flex-1 px-2 py-1.5 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value={0}>-- Category --</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                    {/* Subcategory */}
                    <select
                      value={row.subcategory_id}
                      onChange={(e) => updateRow(row.id, 'subcategory_id', Number(e.target.value))}
                      disabled={!row.category_id || subs.length === 0}
                      className="flex-1 px-2 py-1.5 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value={0}>-- Subcategory --</option>
                      {subs.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {sub.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {/* Remove button */}
                <button
                  onClick={() => removeRow(row.id)}
                  disabled={rows.length <= 1}
                  className="text-muted-foreground hover:text-red-500 p-1 mt-1 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Remove row"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}

          {/* Add row button */}
          <button
            onClick={addRow}
            className="w-full py-2 text-sm font-medium text-muted-foreground border border-dashed border-input rounded-md hover:bg-muted/50 hover:text-foreground"
          >
            + Add Row
          </button>
        </div>

        {/* Footer with totals and actions */}
        <div className="p-6 border-t shrink-0 space-y-3">
          {/* Running totals */}
          <div className="flex justify-between text-sm">
            <span>
              Allocated:{' '}
              <span className={`font-semibold ${allocatedColor}`}>
                {formatCurrency(allocated)}
              </span>
              {' / '}
              <span className="font-semibold">{formatCurrency(parentAmount)}</span>
            </span>
            <span>
              Remaining:{' '}
              <span className={`font-semibold ${isBalanced ? 'text-green-600' : remaining > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                {formatCurrency(remaining)}
              </span>
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!isBalanced || rows.length < 2}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm Split
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
