import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { importApi } from '@/api/client';
import type { Account, CsvParseResult } from '@/types';

interface Props {
  accounts: Account[];
  onComplete: (file: File, account: Account, currency: 'AUD' | 'USD', parseResult: CsvParseResult) => void;
}

export default function StepUpload({ accounts, onComplete }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<number | ''>('');
  const [currency, setCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (f: File) => {
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file.');
      return;
    }
    setError(null);
    setFile(f);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a CSV file.');
      return;
    }
    if (!accountId) {
      setError('Please select an account.');
      return;
    }

    const account = accounts.find((a) => a.id === accountId);
    if (!account) {
      setError('Selected account not found.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const parseResult: CsvParseResult = await importApi.parse(file, accountId);
      onComplete(file, account, currency, parseResult);
    } catch (err: any) {
      setError(err.message || 'Failed to parse CSV file.');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="max-w-xl space-y-6">
      {/* File drop zone */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Select CSV File</h2>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelect(f);
            }}
          />
          <div className="text-muted-foreground">
            <p className="text-base font-medium">
              Drag and drop a CSV file here, or click to browse
            </p>
            <p className="text-sm mt-1">Only .csv files are accepted</p>
          </div>
        </div>

        {file && (
          <div className="flex items-center gap-3 p-3 bg-secondary rounded-md">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                if (inputRef.current) inputRef.current.value = '';
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Account selector */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Account</h2>

        <div>
          <label className="block text-sm font-medium mb-1">
            Select Account
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : '')}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">-- Select an account --</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </select>
          <p className="text-sm text-muted-foreground mt-1">
            Don't see your account?{' '}
            <Link to="/accounts" className="text-primary hover:underline">
              Create a new account
            </Link>
          </p>
        </div>
      </div>

      {/* Currency selector */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Currency</h2>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="currency"
              value="AUD"
              checked={currency === 'AUD'}
              onChange={() => setCurrency('AUD')}
              className="accent-primary"
            />
            <span className="text-sm font-medium">AUD</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="currency"
              value="USD"
              checked={currency === 'USD'}
              onChange={() => setCurrency('USD')}
              className="accent-primary"
            />
            <span className="text-sm font-medium">USD</span>
          </label>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Upload button */}
      <button
        onClick={handleUpload}
        disabled={loading || !file || !accountId}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? 'Uploading & Parsing...' : 'Upload & Parse'}
      </button>
    </div>
  );
}
