import { useState, useEffect } from 'react';
import { accounts as accountsApi } from '@/api/client';
import type { Account, ColumnMap, CsvParseResult } from '@/types';
import StepUpload from './StepUpload';
import StepColumnMap from './StepColumnMap';
import StepPreview from './StepPreview';
import StepCategorize from './StepCategorize';

const STEPS = ['Upload', 'Map Columns', 'Preview', 'Categorize'] as const;

export default function ImportWizard() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [currency, setCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    accountsApi.list().then(setAccounts).catch(() => {});
  }, []);

  const handleUploadComplete = (
    f: File,
    account: Account,
    cur: 'AUD' | 'USD',
    result: CsvParseResult,
  ) => {
    setFile(f);
    setSelectedAccount(account);
    setCurrency(cur);
    setParseResult(result);
    setStep(2);
  };

  const handleColumnMapComplete = (map: ColumnMap) => {
    setColumnMap(map);
    setStep(3);
  };

  const handlePreviewComplete = (id: number) => {
    setBatchId(id);
    setStep(4);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Import CSV</h1>

      {/* Step indicator */}
      <div className="flex gap-2 mb-6 mt-4">
        {STEPS.map((label, i) => {
          const stepNum = i + 1;
          const isActive = stepNum === step;
          const isCompleted = stepNum < step;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`w-8 h-px ${
                    isCompleted ? 'bg-primary' : 'bg-border'
                  }`}
                />
              )}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isCompleted
                      ? 'bg-primary/20 text-primary'
                      : 'bg-secondary text-muted-foreground'
                }`}
              >
                {stepNum}. {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      {step === 1 && (
        <StepUpload accounts={accounts} onComplete={handleUploadComplete} />
      )}
      {step === 2 && parseResult && (
        <StepColumnMap
          parseResult={parseResult}
          onComplete={handleColumnMapComplete}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && file && selectedAccount && columnMap && parseResult && (
        <StepPreview
          file={file}
          accountId={selectedAccount.id}
          currency={currency}
          columnMap={columnMap}
          filename={file.name}
          parseResult={parseResult}
          onComplete={handlePreviewComplete}
          onBack={() => setStep(2)}
        />
      )}
      {step === 4 && batchId !== null && <StepCategorize batchId={batchId} />}
    </div>
  );
}
