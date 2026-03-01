import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  batchId: number;
}

export default function StepCategorize({ batchId }: Props) {
  const navigate = useNavigate();
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (started) return;
    setStarted(true);
    cancelledRef.current = false;

    // Use /categorize-next in a loop — one LLM batch per call (~30-120s each).
    // Much more robust than SSE: each request is a normal short-lived HTTP
    // roundtrip so proxy/timeout issues don't affect it.
    const run = async () => {
      try {
        // Go directly to Express to avoid Vite proxy for long-running requests.
        // CORS is enabled globally on the server (app.use(cors())).
        const serverBase = import.meta.env.DEV ? 'http://localhost:3001' : '';

        while (!cancelledRef.current) {
          const response = await fetch(`${serverBase}/api/import/${batchId}/categorize-next`, {
            method: 'POST',
          });

          if (!response.ok) {
            const err = await response.json().catch(() => ({ error: response.statusText }));
            setError(err.error || 'Categorization failed.');
            return;
          }

          const data: { done: number; total: number; remaining: number } = await response.json();
          setProgress({ done: data.done, total: data.total });

          if (data.remaining === 0) {
            setComplete(true);
            return;
          }
        }
      } catch (err: any) {
        if (!cancelledRef.current) {
          setError(err.message || 'Categorization failed.');
        }
      }
    };

    run();

    return () => {
      cancelledRef.current = true;
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
            <p className="text-xs text-red-700 dark:text-red-300 mt-1">
              {progress.done} of {progress.total} transactions were categorized before the error.
              You can still review what was completed, then use &ldquo;Resume Categorization&rdquo; on the review page.
            </p>
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

        {/* Action button — shown on complete OR on error (to review partial results) */}
        {(complete || error) && (
          <button
            onClick={() => navigate(`/import/${batchId}/review`)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            {complete ? 'Review Results' : 'Review Partial Results'}
          </button>
        )}
      </div>
    </div>
  );
}
