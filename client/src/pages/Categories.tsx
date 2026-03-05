import { useState, useEffect } from 'react';
import { categories } from '@/api/client';
import type { Category, CategoryWithChildren } from '@/types';
import { ChevronDown, ChevronRight, Pencil, Trash2, Plus } from 'lucide-react';

export default function Categories() {
  const [tree, setTree] = useState<CategoryWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Add form state
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const fetchCategories = async () => {
    try {
      // The server already returns top-level categories with children nested inside
      const withChildren = (await categories.list()) as CategoryWithChildren[];
      setTree(withChildren);
      // Auto-expand all parents that have children
      setExpanded(new Set(withChildren.filter((c) => c.children.length > 0).map((c) => c.id)));
    } catch {
      // silently fail — empty state will show
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await categories.create({
        name: newName.trim(),
        parent_id: newParentId ?? undefined,
      });
      setNewName('');
      setNewParentId(null);
      await fetchCategories();
    } catch (err: any) {
      setAddError(err.message || 'Failed to create category.');
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleRename = async (id: number) => {
    if (!editName.trim()) return;
    setRenaming(true);
    try {
      await categories.rename(id, editName.trim());
      setEditingId(null);
      setEditName('');
      await fetchCategories();
    } catch (err: any) {
      // show inline error briefly
      alert(err.message || 'Failed to rename category.');
    } finally {
      setRenaming(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleteError('');
    try {
      await categories.delete(id);
      setDeletingId(null);
      await fetchCategories();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete category.');
    }
  };

  const topLevelCategories = tree;

  const renderCategory = (cat: Category, isChild: boolean = false) => {
    const isEditing = editingId === cat.id;
    const isConfirmingDelete = deletingId === cat.id;

    return (
      <div key={cat.id} className="flex items-center justify-between gap-2 py-1">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(cat.id);
                  if (e.key === 'Escape') cancelEdit();
                }}
                className="flex-1 px-2 py-1 text-sm border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
                disabled={renaming}
              />
              <button
                onClick={() => handleRename(cat.id)}
                disabled={renaming}
                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {renaming ? '...' : 'Save'}
              </button>
              <button
                onClick={cancelEdit}
                disabled={renaming}
                className="px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
              >
                Cancel
              </button>
            </div>
          ) : isConfirmingDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">Delete "{cat.name}"?</span>
              <button
                onClick={() => handleDelete(cat.id)}
                className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
              >
                Confirm
              </button>
              <button
                onClick={() => { setDeletingId(null); setDeleteError(''); }}
                className="px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
              >
                Cancel
              </button>
              {deleteError && deletingId === cat.id && (
                <span className="text-xs text-destructive">{deleteError}</span>
              )}
            </div>
          ) : (
            <span className={`text-sm ${isChild ? 'text-muted-foreground' : 'font-medium'}`}>
              {cat.name}
            </span>
          )}
        </div>
        {!isEditing && !isConfirmingDelete && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => startEdit(cat)}
              className="p-1 rounded hover:bg-secondary transition-colors"
              title="Rename"
            >
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => { setDeletingId(cat.id); setDeleteError(''); }}
              className="p-1 rounded hover:bg-secondary transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Categories</h1>
        <p className="text-muted-foreground mt-4">Loading categories...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Categories</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Left: Category Tree */}
        <div className="lg:col-span-2 bg-card border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Category Tree</h2>

          {topLevelCategories.length === 0 ? (
            <p className="text-muted-foreground text-sm">No categories yet. Add one to get started.</p>
          ) : (
            <div className="space-y-2">
              {topLevelCategories.map((parent) => {
                const isExpanded = expanded.has(parent.id);
                const hasChildren = parent.children.length > 0;

                return (
                  <div key={parent.id} className="border rounded p-3">
                    <div className="flex items-center gap-2">
                      {hasChildren ? (
                        <button
                          onClick={() => toggleExpand(parent.id)}
                          className="p-0.5 rounded hover:bg-secondary transition-colors shrink-0"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                      ) : (
                        <span className="w-5" />
                      )}
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          {renderCategory(parent)}
                        </div>
                        {hasChildren && (
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                            {parent.children.length}
                          </span>
                        )}
                      </div>
                    </div>

                    {isExpanded && parent.children.length > 0 && (
                      <div className="ml-6 border-l pl-3 mt-2 space-y-1">
                        {parent.children.map((child) => renderCategory(child, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Add Category Form */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Add Category</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
                placeholder="Category name"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Parent Category</label>
              <select
                value={newParentId ?? ''}
                onChange={(e) => setNewParentId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">None (top-level)</option>
                {topLevelCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Adding...' : 'Add Category'}
            </button>

            {addError && (
              <p className="text-sm text-destructive">{addError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
