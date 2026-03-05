import { useState, useEffect, useMemo } from 'react';
import type { ExpenseWithSuggestion, CategoryWithChildren } from '@/types';
import { categories as categoriesApi } from '@/api/client';
import CategoryCombobox from './CategoryCombobox';
import { Pencil } from 'lucide-react';

interface Props {
  expense: ExpenseWithSuggestion;
  categories: CategoryWithChildren[];
  onApprove: (id: number, categoryId: number, subcategoryId?: number) => void;
  onDelete: (id: number) => void;
  onSplit: (expense: ExpenseWithSuggestion) => void;
  onCategoryCreated: (cat: CategoryWithChildren) => void;
}

const confidenceBadge = (confidence: string | null) => {
  switch (confidence) {
    case 'rule':
      return { label: 'Rule Match', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' };
    case 'high':
      return { label: 'High', classes: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' };
    case 'medium':
      return { label: 'Medium', classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' };
    case 'low':
      return { label: 'Low', classes: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' };
    default:
      return { label: 'Uncategorized', classes: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' };
  }
};

const statusBadge = (status: string, confidence: string | null) => {
  if (status === 'approved' && confidence === 'rule') {
    return { label: 'Approved (Rule)', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' };
  }
  if (status === 'approved') {
    return { label: 'Approved', classes: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' };
  }
  if (status === 'skipped') {
    return { label: 'Skipped', classes: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' };
  }
  if (status === 'split') {
    return { label: 'Split', classes: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' };
  }
  return null;
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function formatCurrency(amount: number, currency?: string): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount).toFixed(2);
  const prefix = currency === 'USD' ? 'US$' : '$';
  return `${sign}${prefix}${abs}`;
}

export default function ExpenseCard({ expense, categories, onApprove, onDelete, onSplit, onCategoryCreated }: Props) {
  const initialCatId = expense.suggested_category_id ?? expense.category_id ?? 0;
  const initialSubId = expense.suggested_subcategory_id ?? expense.subcategory_id ?? 0;

  const [selectedCategory, setSelectedCategory] = useState<number>(initialCatId);
  const [selectedSubcategory, setSelectedSubcategory] = useState<number>(initialSubId);
  const [showReasoning, setShowReasoning] = useState(false);
  const [isEditingCategory, setIsEditingCategory] = useState(false);

  useEffect(() => {
    setIsEditingCategory(false);
    // For approved items seed from the actual approved category, not the original suggestion
    if (expense.review_status === 'approved') {
      setSelectedCategory(expense.category_id ?? expense.suggested_category_id ?? 0);
      setSelectedSubcategory(expense.subcategory_id ?? expense.suggested_subcategory_id ?? 0);
    } else {
      setSelectedCategory(expense.suggested_category_id ?? expense.category_id ?? 0);
      setSelectedSubcategory(expense.suggested_subcategory_id ?? expense.subcategory_id ?? 0);
    }
  }, [expense.id, expense.review_status, expense.suggested_category_id, expense.category_id, expense.suggested_subcategory_id, expense.subcategory_id]);

  // All subcategories from all parents — for the cross-tree search
  const allSubcategories = useMemo(
    () =>
      categories.flatMap((c) =>
        c.children.map((sub) => ({
          id: sub.id,
          name: sub.name,
          secondaryLabel: c.name,
          parent_id: c.id,
        }))
      ),
    [categories]
  );

  const handleCategoryChange = (catId: number) => {
    setSelectedCategory(catId);
    // Reset subcategory only if it doesn't belong to the new parent
    const newParent = categories.find((c) => c.id === catId);
    const childIds = newParent?.children.map((c) => c.id) ?? [];
    if (!childIds.includes(selectedSubcategory)) {
      setSelectedSubcategory(0);
    }
  };

  const handleSubcategoryChange = (subId: number) => {
    setSelectedSubcategory(subId);
    if (subId !== 0) {
      // Auto-fill parent if this subcategory belongs to a different parent
      const sub = allSubcategories.find((s) => s.id === subId);
      if (sub && sub.parent_id !== selectedCategory) {
        setSelectedCategory(sub.parent_id);
      }
    }
  };

  const handleApprove = () => {
    if (!selectedCategory) return;
    onApprove(expense.id, selectedCategory, selectedSubcategory || undefined);
  };

  const badge = confidenceBadge(expense.confidence);
  const status = statusBadge(expense.review_status, expense.confidence);
  const isPending = expense.review_status === 'pending';
  const isApproved = expense.review_status === 'approved';
  const isRuleApproved = isApproved && expense.confidence === 'rule';
  const showActions = isPending;
  const showCategorySelectors = isPending || isRuleApproved || (isApproved && !isRuleApproved && isEditingCategory);
  const showEditCategoryButton = isApproved && !isRuleApproved && !isEditingCategory;

  // Compute display names live from the categories prop so they stay correct after re-approval
  const displayCatName =
    expense.category_id
      ? (categories.find((c) => c.id === expense.category_id)?.name ?? expense.category_name)
      : expense.category_name;
  const displaySubName =
    expense.subcategory_id
      ? (allSubcategories.find((s) => s.id === expense.subcategory_id)?.name ?? expense.subcategory_name)
      : expense.subcategory_name;

  return (
    <div className="bg-card border rounded-lg p-4 space-y-3">
      {/* Top row: date, description, amount, badges */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {expense.date}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${badge.classes}`}>
              {badge.label}
            </span>
            {status && (
              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${status.classes}`}>
                {status.label}
              </span>
            )}
          </div>
          <p className="text-sm font-medium mt-1" title={expense.description}>
            {truncate(expense.description, 60)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold">
            {formatCurrency(expense.amount_aud)}
          </p>
          {expense.currency_original !== 'AUD' && (
            <p className="text-xs text-muted-foreground">
              {formatCurrency(expense.amount_original, expense.currency_original)} {expense.currency_original}
            </p>
          )}
        </div>
      </div>

      {/* LLM reasoning (collapsible) */}
      {expense.llm_reasoning && (
        <div>
          <button
            type="button"
            onClick={() => setShowReasoning(!showReasoning)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <svg
              className={`w-3 h-3 transition-transform ${showReasoning ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            LLM Reasoning
          </button>
          {showReasoning && (
            <p className="text-xs text-muted-foreground mt-1 ml-4 bg-muted/50 rounded p-2">
              {expense.llm_reasoning}
            </p>
          )}
        </div>
      )}

      {/* Category selectors */}
      {showCategorySelectors && (
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Category</label>
            <CategoryCombobox
              items={categories.map((c) => ({ id: c.id, name: c.name }))}
              value={selectedCategory}
              onChange={handleCategoryChange}
              placeholder="Select category"
              onCreateNew={async (name) => {
                const created = await categoriesApi.create({ name });
                onCategoryCreated({ ...created, children: [] });
                return created;
              }}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium mb-1 text-muted-foreground">Subcategory</label>
            <CategoryCombobox
              items={allSubcategories}
              value={selectedSubcategory}
              onChange={handleSubcategoryChange}
              placeholder="Select subcategory"
              onCreateNew={
                selectedCategory
                  ? async (name) => {
                      const created = await categoriesApi.create({ name, parent_id: selectedCategory });
                      const parentCat = categories.find((c) => c.id === selectedCategory)!;
                      onCategoryCreated({
                        ...parentCat,
                        children: [...(parentCat.children ?? []), created],
                      });
                      return created;
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {/* Category display for non-editable approved/skipped items */}
      {!showCategorySelectors && (displayCatName || expense.suggested_category_name) && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            Category: {displayCatName || expense.suggested_category_name}
            {(displaySubName || expense.suggested_subcategory_name) && (
              <> / {displaySubName || expense.suggested_subcategory_name}</>
            )}
          </span>
          {showEditCategoryButton && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory(expense.category_id ?? expense.suggested_category_id ?? 0);
                setSelectedSubcategory(expense.subcategory_id ?? expense.suggested_subcategory_id ?? 0);
                setIsEditingCategory(true);
              }}
              className="p-0.5 rounded hover:bg-secondary transition-colors"
              title="Edit category"
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      {showActions && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleApprove}
            disabled={!selectedCategory}
            className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve
          </button>
          <button
            onClick={() => onDelete(expense.id)}
            className="px-3 py-1.5 text-sm font-medium border border-destructive text-destructive rounded-md hover:bg-destructive/10"
          >
            Delete
          </button>
          <button
            onClick={() => onSplit(expense)}
            className="px-3 py-1.5 text-sm font-medium border border-blue-500 text-blue-600 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950"
          >
            Split
          </button>
        </div>
      )}

      {/* For rule-approved items, allow category change */}
      {isRuleApproved && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleApprove}
            disabled={!selectedCategory}
            className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Update Category
          </button>
        </div>
      )}

      {/* For non-rule approved items in edit mode */}
      {isApproved && !isRuleApproved && isEditingCategory && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => { setIsEditingCategory(false); handleApprove(); }}
            disabled={!selectedCategory}
            className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Update Category
          </button>
          <button
            onClick={() => {
              setSelectedCategory(expense.category_id ?? expense.suggested_category_id ?? 0);
              setSelectedSubcategory(expense.subcategory_id ?? expense.suggested_subcategory_id ?? 0);
              setIsEditingCategory(false);
            }}
            className="px-3 py-1.5 text-sm font-medium bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Split children display */}
      {expense.review_status === 'split' && expense.children && expense.children.length > 0 && (
        <div className="mt-2 ml-4 space-y-1 border-l-2 border-purple-300 pl-3">
          <p className="text-xs font-medium text-muted-foreground">Split into:</p>
          {expense.children.map((child) => (
            <div key={child.id} className="flex justify-between text-xs text-muted-foreground">
              <span>{truncate(child.description, 40)}</span>
              <span>{formatCurrency(child.amount_aud)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
