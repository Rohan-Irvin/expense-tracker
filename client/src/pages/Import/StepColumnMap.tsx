import { useState, useEffect } from 'react';
import type { CsvParseResult, ColumnMap } from '@/types';

interface Props {
  parseResult: CsvParseResult;
  onComplete: (columnMap: ColumnMap) => void;
  onBack: () => void;
}

export default function StepColumnMap({ parseResult, onComplete, onBack }: Props) {
  const { columns, sampleRows, hasHeader, suggestedMapping } = parseResult;

  const [dateCol, setDateCol] = useState('');
  const [descriptionCol, setDescriptionCol] = useState('');
  const [amountType, setAmountType] = useState<'single' | 'split'>('single');
  const [amountCol, setAmountCol] = useState('');
  const [debitCol, setDebitCol] = useState('');
  const [creditCol, setCreditCol] = useState('');
  const [dateFormat, setDateFormat] = useState<ColumnMap['dateFormat']>('DD/MM/YYYY');
  const [signConvention, setSignConvention] = useState<'negative_is_debit' | 'positive_is_debit'>('negative_is_debit');
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from suggested mapping
  useEffect(() => {
    if (suggestedMapping) {
      if (suggestedMapping.date) setDateCol(suggestedMapping.date);
      if (suggestedMapping.description) setDescriptionCol(suggestedMapping.description);
      if (suggestedMapping.amount_type) setAmountType(suggestedMapping.amount_type);
      if (suggestedMapping.amount) setAmountCol(suggestedMapping.amount);
      if (suggestedMapping.debit) setDebitCol(suggestedMapping.debit);
      if (suggestedMapping.credit) setCreditCol(suggestedMapping.credit);
      if (suggestedMapping.dateFormat) setDateFormat(suggestedMapping.dateFormat);
      if (suggestedMapping.sign_convention) setSignConvention(suggestedMapping.sign_convention);
    }
  }, [suggestedMapping]);

  const getSampleValue = (col: string): string => {
    if (sampleRows.length === 0) return '';
    return sampleRows[0][col] ?? '';
  };

  const handleNext = () => {
    setError(null);

    if (!dateCol) {
      setError('Please select a Date column.');
      return;
    }
    if (!descriptionCol) {
      setError('Please select a Description column.');
      return;
    }
    if (amountType === 'single' && !amountCol) {
      setError('Please select an Amount column.');
      return;
    }
    if (amountType === 'split' && (!debitCol || !creditCol)) {
      setError('Please select both Debit and Credit columns.');
      return;
    }

    const map: ColumnMap = {
      hasHeader,
      date: dateCol,
      description: descriptionCol,
      amount_type: amountType,
      dateFormat,
    };

    if (amountType === 'single') {
      map.amount = amountCol;
      map.sign_convention = signConvention;
    } else {
      map.debit = debitCol;
      map.credit = creditCol;
    }

    onComplete(map);
  };

  const renderColumnSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">-- Select column --</option>
        {columns.map((col) => (
          <option key={col} value={col}>
            {col}{getSampleValue(col) ? ` (e.g. "${getSampleValue(col)}")` : ''}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header detection warning */}
      {!hasHeader && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-300 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
            No header row detected. Columns are labeled by their index position.
          </p>
        </div>
      )}

      {/* Column mapping */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Map Columns</h2>

        {renderColumnSelect('Date', dateCol, setDateCol)}

        {/* Date Format */}
        <div>
          <label className="block text-sm font-medium mb-1">Date Format</label>
          <select
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as ColumnMap['dateFormat'])}
            className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            <option value="MM/DD/YYYY">MM/DD/YYYY</option>
            <option value="YYYYMMDD">YYYYMMDD</option>
          </select>
        </div>

        {renderColumnSelect('Description', descriptionCol, setDescriptionCol)}

        {/* Amount type toggle */}
        <div>
          <label className="block text-sm font-medium mb-2">Amount Type</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAmountType('single')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                amountType === 'single'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              Single Column
            </button>
            <button
              type="button"
              onClick={() => setAmountType('split')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                amountType === 'split'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
            >
              Split Debit / Credit
            </button>
          </div>
        </div>

        {amountType === 'single' ? (
          <>
            {renderColumnSelect('Amount', amountCol, setAmountCol)}

            {/* Sign convention */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Sign Convention
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="signConvention"
                    value="negative_is_debit"
                    checked={signConvention === 'negative_is_debit'}
                    onChange={() => setSignConvention('negative_is_debit')}
                    className="accent-primary"
                  />
                  <span className="text-sm">Negative = debit</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="signConvention"
                    value="positive_is_debit"
                    checked={signConvention === 'positive_is_debit'}
                    onChange={() => setSignConvention('positive_is_debit')}
                    className="accent-primary"
                  />
                  <span className="text-sm">Positive = debit</span>
                </label>
              </div>
            </div>
          </>
        ) : (
          <>
            {renderColumnSelect('Debit Column', debitCol, setDebitCol)}
            {renderColumnSelect('Credit Column', creditCol, setCreditCol)}
          </>
        )}
      </div>

      {/* Sample data preview */}
      {sampleRows.length > 0 && (
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">Sample Data</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="text-left py-2 px-3 font-medium text-muted-foreground"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.slice(0, 3).map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {columns.map((col) => (
                      <td key={col} className="py-2 px-3">
                        {row[col] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Navigation buttons */}
      <div className="flex gap-2">
        <button
          onClick={onBack}
          className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
        >
          Back
        </button>
        <button
          onClick={handleNext}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Next
        </button>
      </div>
    </div>
  );
}
