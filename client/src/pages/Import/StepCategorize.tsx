import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  batchId: number;
}

interface ProgressEvent {
  done: number;
  total: number;
  complete?: boolean;
  error?: string;
}

export default function StepCategorize({ batchId }: Props) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ProgressEvent>({ done: 0, total: 0 });
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (started) return;
    setStarted(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    const run = async () => {
      try {
        const response = await fetch(`/api/import/${batchId}/categorize`, {
          method: 'POST',
          signal: abortController.signal,
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: response.statusText }));
          setError(err.error || 'Failed to start categorization.');
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const event: ProgressEvent = JSON.parse(jsonStr);
                setProgress({ done: event.done, total: event.total });

                if (event.complete) {
                  setComplete(true);
                }
                if (event.error) {
                  setError(event.error);
                }
              } catch {
                // Ignore malformed JSON lines
              }
            }
          }
        }

        // If stream ended without a complete event, mark as complete
        if (!complete) {
          setComplete(true);
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Categorization failed.');
        }
      }
    };

    run();

    return () => {
      abortController.abort();
    };
  }, [batchId]);

  const percentage =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="max-w-xl space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-6">
        <h2 className="text-lg font-semibold">
          {complete ? 'Categorization Complete' : 'Categorizing Transactions'}
        </h2>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="w-full bg-secondary rounded-full h-3 overflow-hidden">
            <div
              className="bg-primary h-3 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {complete
              ? `Categorized ${progress.done} of ${progress.total} transactions`
              : progress.total > 0
                ? `Categorizing... ${progress.done} of ${progress.total} transactions (${percentage}%)`
                : 'Starting categorization...'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Complete state */}
        {complete && !error && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-300 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-800 dark:text-green-200 font-medium">
              All transactions have been categorized by the LLM. Review the
              suggestions and approve or adjust as needed.
            </p>
          </div>
        )}

        {/* Action button */}
        {complete && (
          <button
            onClick={() => navigate(`/import/${batchId}/review`)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Review Results
          </button>
        )}
      </div>
    </div>
  );
}
