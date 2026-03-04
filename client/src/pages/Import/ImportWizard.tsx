import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { accounts as accountsApi, importApi } from '@/api/client';
import type { Account, ColumnMap, CsvParseResult } from '@/types';
import StepUpload from './StepUpload';
import StepColumnMap from './StepColumnMap';
import StepPreview from './StepPreview';
import StepCategorize from './StepCategorize';
import { Clock, ArrowRight, Trash2 } from 'lucide-react';

const STEPS = ['Upload', 'Map Columns', 'Preview', 'Categorize'] as const;

interface PendingBatch {
  id: number;
  filename: string;
  imported_at: string;
  row_count: number;
  account_name: string;
  total_expenses: number;
  categorized_count: number;
  pending_count: number;
}

function formatImportDate(isoString: string): string {
  try {
    const d = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return isoString;
  }
}

export default function ImportWizard() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [currency, setCurrency] = useState<'AUD' | 'USD'>('AUD');
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [columnMap, setColumnMap] = useState<ColumnMap | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pendingBatches, setPendingBatches] = useState<PendingBatch[]>([]);
  // batchId → 'confirming' | 'deleting'
  const [deleteState, setDeleteState] = useState<Record<number, 'confirming' | 'deleting'>>({});

  useEffect(() => {
    accountsApi.list().then(setAccounts).catch(() => {});
    importApi.pendingBatches().then(setPendingBatches).catch(() => {});
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

  const handleDeleteClick = (id: number) => {
    setDeleteState((s) => ({ ...s, [id]: 'confirming' }));
  };

  const handleDeleteCancel = (id: number) => {
    setDeleteState((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
  };

  const handleDeleteConfirm = async (id: number) => {
    setDeleteState((s) => ({ ...s, [id]: 'deleting' }));
    try {
      await importApi.deleteBatch(id);
      setPendingBatches((bs) => bs.filter((b) => b.id !== id));
    } catch {
      // On error restore to idle so user can retry
      setDeleteState((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Import CSV</h1>

      {/* In-progress batches — only shown on step 1 */}
      {step === 1 && pendingBatches.length > 0 && (
        <div className="mt-4 mb-6 border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" />
            {pendingBatches.length} import{pendingBatches.length !== 1 ? 's' : ''} in progress
          </h2>
          <div className="space-y-2">
            {pendingBatches.map((batch) => {
              const allCategorized = batch.categorized_count >= batch.total_expenses;
              const statusText = !allCategorized
                ? `${batch.categorized_count} / ${batch.total_expenses} categorized`
                : batch.pending_count > 0
                  ? `${batch.pending_count} transaction${batch.pending_count !== 1 ? 's' : ''} awaiting review`
                  : 'Ready to finalize';

              const ds = deleteState[batch.id];

              return (
                <div
                  key={batch.id}
                  className="flex items-center justify-between bg-background rounded-md px-3 py-2.5 border"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {batch.account_name}
                      <span className="text-muted-foreground font-normal"> — {batch.filename}</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatImportDate(batch.imported_at)} · {batch.total_expenses} transactions · {statusText}
                    </p>
                  </div>

                  <div className="ml-3 shrink-0 flex items-center gap-2">
                    {/* Delete controls */}
                    {!ds && (
                      <button
                        onClick={() => handleDeleteClick(batch.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                        title="Delete import"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {ds === 'confirming' && (
                      <div className="flex items-center gap-1.5 text-sm">
                        <span className="text-destructive font-medium">Delete?</span>
                        <button
                          onClick={() => handleDeleteConfirm(batch.id)}
                          className="px-2 py-1 bg-destructive text-destructive-foreground rounded text-xs font-medium hover:bg-destructive/90 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => handleDeleteCancel(batch.id)}
                          className="px-2 py-1 bg-secondary text-secondary-foreground rounded text-xs font-medium hover:bg-secondary/80 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    )}
                    {ds === 'deleting' && (
                      <span className="text-xs text-muted-foreground">Deleting…</span>
                    )}

                    {/* Continue button — hidden while confirming/deleting */}
                    {!ds && (
                      <Link
                        to={`/import/${batch.id}/review`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                      >
                        Continue
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
