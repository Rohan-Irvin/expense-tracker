import { useState, useEffect } from 'react';
import { accounts } from '@/api/client';
import type { Account } from '@/types';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';

export default function Accounts() {
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');

  // Add form state
  const [newName, setNewName] = useState('');
  const [newCurrency, setNewCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const fetchAccounts = async () => {
    try {
      const data = await accounts.list();
      setAccountList(data);
    } catch {
      // silently fail — empty state will show
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  // ── Add ──────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await accounts.create({ name: newName.trim(), currency: newCurrency });
      setNewName('');
      setNewCurrency('AUD');
      await fetchAccounts();
    } catch (err: any) {
      setAddError(err.message || 'Failed to create account.');
    } finally {
      setAdding(false);
    }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────

  const startEdit = (account: Account) => {
    setEditingId(account.id);
    setEditName(account.name);
    setEditError('');
    setConfirmDeleteId(null);
    setDeleteError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditError('');
  };

  const handleUpdate = async (id: number) => {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditError('');
    try {
      await accounts.update(id, { name: editName.trim() });
      setEditingId(null);
      await fetchAccounts();
    } catch (err: any) {
      setEditError(err.message || 'Failed to update account.');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async (id: number) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setDeleteError('');
      setEditingId(null);
      return;
    }
    try {
      await (accounts as any).delete(id);
      setConfirmDeleteId(null);
      await fetchAccounts();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete account.');
      setConfirmDeleteId(null);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Accounts</h1>
        <p className="text-muted-foreground mt-4">Loading accounts…</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Accounts</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">

        {/* Account List */}
        <div className="lg:col-span-2 bg-card border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Your Accounts</h2>

          {deleteError && (
            <p className="text-sm text-destructive mb-3">{deleteError}</p>
          )}

          {accountList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No accounts yet. Add one to get started.</p>
          ) : (
            <div className="space-y-2">
              {accountList.map((account) => {
                const isEditing = editingId === account.id;
                const isConfirmingDelete = confirmDeleteId === account.id;

                if (isEditing) {
                  return (
                    <div
                      key={account.id}
                      className="flex items-center gap-2 p-3 border rounded bg-muted/30"
                    >
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdate(account.id);
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        autoFocus
                        className="flex-1 px-2 py-1 text-sm border border-input rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-secondary text-secondary-foreground shrink-0">
                        {account.currency}
                      </span>
                      <button
                        onClick={() => handleUpdate(account.id)}
                        disabled={editSaving || !editName.trim()}
                        title="Save"
                        className="p-1.5 rounded text-green-600 hover:bg-green-100 dark:hover:bg-green-900 disabled:opacity-50"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={editSaving}
                        title="Cancel"
                        className="p-1.5 rounded text-muted-foreground hover:bg-muted"
                      >
                        <X size={15} />
                      </button>
                      {editError && (
                        <span className="text-xs text-destructive ml-1">{editError}</span>
                      )}
                    </div>
                  );
                }

                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 border rounded group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-medium truncate">{account.name}</span>
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-secondary text-secondary-foreground shrink-0">
                        {account.currency}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 ml-2">
                      {isConfirmingDelete ? (
                        <>
                          <span className="text-xs text-destructive font-medium mr-1">Delete?</span>
                          <button
                            onClick={() => handleDelete(account.id)}
                            className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => { setConfirmDeleteId(null); setDeleteError(''); }}
                            className="p-1.5 rounded text-muted-foreground hover:bg-muted"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEdit(account)}
                            title="Edit name"
                            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(account.id)}
                            title="Delete account"
                            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add Account Form */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Add Account</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Account Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                placeholder="e.g. Westpac Savings"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value as 'AUD' | 'USD')}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="AUD">AUD</option>
                <option value="USD">USD</option>
              </select>
            </div>

            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Adding…' : 'Add Account'}
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
