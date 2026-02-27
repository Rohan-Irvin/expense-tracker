import { useState, useEffect } from 'react';
import { accounts } from '@/api/client';
import type { Account } from '@/types';
import { Plus } from 'lucide-react';

export default function Accounts() {
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Accounts</h1>
        <p className="text-muted-foreground mt-4">Loading accounts...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Accounts</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Left: Account List */}
        <div className="lg:col-span-2 bg-card border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Your Accounts</h2>

          {accountList.length === 0 ? (
            <p className="text-muted-foreground text-sm">No accounts yet. Add one to get started.</p>
          ) : (
            <div className="space-y-2">
              {accountList.map((account) => (
                <div
                  key={account.id}
                  className="flex justify-between items-center p-3 border rounded mb-2"
                >
                  <span className="text-sm font-medium">{account.name}</span>
                  <span className="px-2 py-1 text-xs font-medium rounded bg-secondary text-secondary-foreground">
                    {account.currency}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Add Account Form */}
        <div className="bg-card border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Add Account</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Account Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
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
              {adding ? 'Adding...' : 'Add Account'}
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
