/**
 * Pre-advance grace countdown banner (ROK-1253).
 *
 * Renders prominently above the lineup detail header when quorum has just
 * closed and the lineup will auto-advance to its next phase after a short
 * grace window. Operator/voter copy: "Phase advances in {Xm Ys} —
 * undo your last action to keep nominating/voting".
 *
 * Lifecycle: re-renders every second via `setInterval`. Nulls itself when
 * `pendingAdvanceAt` is null or already past — the lineup data hook
 * invalidates on the same WebSocket events that change the underlying row,
 * so the banner re-mounts naturally on grace lifecycle changes.
 */
import { useEffect, useState, type JSX } from 'react';

interface Props {
  pendingAdvanceAt: string | null;
  status: string;
}

function computeRemaining(deadlineIso: string): number {
  return new Date(deadlineIso).getTime() - Date.now();
}

/** "1m 30s" / "45s" / "1h 0m 5s" — never returns "0s". */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function ActionVerb({ status }: { status: string }): string {
  if (status === 'building') return 'nominating';
  if (status === 'voting') return 'voting';
  return 'participating';
}

export function GraceCountdownBanner(props: Props): JSX.Element | null {
  const { pendingAdvanceAt, status } = props;
  // Mirrors PhaseCountdown's pattern: derive remaining from a tick counter
  // bumped every second. The remaining value is computed each render, so we
  // don't need to setState synchronously inside the effect.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!pendingAdvanceAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1_000);
    return () => clearInterval(id);
  }, [pendingAdvanceAt]);

  if (!pendingAdvanceAt) return null;
  const remaining = computeRemaining(pendingAdvanceAt);
  if (remaining <= 0) return null;

  return (
    <div
      data-testid="grace-countdown-banner"
      className="mb-4 px-4 py-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-50"
      role="status"
      aria-live="polite"
    >
      <div className="text-sm font-medium">
        Phase advances in <span data-testid="grace-countdown-time">{formatRemaining(remaining)}</span>
        {' — undo your last action to keep '}
        {ActionVerb({ status })}
      </div>
    </div>
  );
}
