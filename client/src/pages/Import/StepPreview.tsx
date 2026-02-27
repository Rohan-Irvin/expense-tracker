import { useState } from 'react';
import { importApi } from '@/api/client';
import type { ColumnMap, CsvParseResult } from '@/types';

interface Props {
  file: File;
  accountId: number;
  currency: 'AUD' | 'USD';
  columnMap: ColumnMap;
  filename: string;
  parseResult: CsvParseResult;
  onComplete: (batchId: number) => void;
  onBack: () => void;
}

export default function StepPreview({
  file,
  accountId,
  currency,
  columnMap,
  filename,
  parseResult,
  onComplete,
  onBack,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { sampleRows } = parseResult;

  // Apply column mapping to sample rows for preview
  const previewRows = sampleRows.slice(0, 5).map((row) => {
    const date = row[columnMap.date] ?? '';
    const description = row[columnMap.description] ?? '';

    let amount = '';
    if (columnMap.amount_type === 'single' && columnMap.amount) {
      amount = row[columnMap.amount] ?? '';
    } else if (columnMap.amount_type === 'split') {
      const debitVal = row[columnMap.debit ?? ''] ?? '';
      const creditVal = row[columnMap.credit ?? ''] ?? '';
      if (debitVal && debitVal !== '0') {
        amount = `-${debitVal}`;
      } else if (creditVal) {
        amount = creditVal;
      }
    }

    return { date, description, amount };
  });

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await importApi.confirm(
        file,
        accountId,
        filename,
        columnMap,
        currency,
      );
      onComplete(result.batchId);
    } catch (err: any) {
      setError(err.message || 'Failed to confirm import.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Preview table */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Preview</h2>
        <p className="text-sm text-muted-foreground">
          Showing up to {previewRows.length} sample rows with your column mapping
          applied. Currency: <span className="font-medium">{currency}</span>
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                  Date
                </th>
                <th className="text-left py-2 px-3 font-medium text-muted-foreground">
                  Description
                </th>
                <th className="text-right py-2 px-3 font-medium text-muted-foreground">
                  Amount ({currency})
                </th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 px-3">{row.date}</td>
                  <td className="py-2 px-3">{row.description}</td>
                  <td className="py-2 px-3 text-right font-mono">
                    {row.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {previewRows.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No sample data available to preview.
          </p>
        )}
      </div>

      {/* Import summary */}
      <div className="bg-card border rounded-lg p-6 space-y-2">
        <h2 className="text-lg font-semibold">Import Summary</h2>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>
            <span className="font-medium text-foreground">File:</span>{' '}
            {filename}
          </li>
          <li>
            <span className="font-medium text-foreground">Currency:</span>{' '}
            {currency}
          </li>
          <li>
            <span className="font-medium text-foreground">Date format:</span>{' '}
            {columnMap.dateFormat}
          </li>
          <li>
            <span className="font-medium text-foreground">Amount type:</span>{' '}
            {columnMap.amount_type === 'single'
              ? 'Single column'
              : 'Split debit/credit'}
          </li>
        </ul>
      </div>

      {/* Error message */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Navigation buttons */}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          disabled={loading}
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={handleConfirm}
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Confirming...' : 'Confirm & Import'}
        </button>
      </div>
    </div>
  );
}
