/**
 * Standalone scheduling poll deadline banner (ROK-1217 / F-36).
 * Renders absolute + relative deadline. Switches to urgent styling
 * when less than 24 hours remain. Returns null when no deadline set.
 */
import { useEffect, useState, type JSX } from 'react';
import { format, formatDistanceToNow } from 'date-fns';

interface Props {
  /** Lineup phase deadline (ISO). Null/undefined when no deadline configured. */
  phaseDeadline: string | null | undefined;
}

const SOON_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function formatAbsolute(date: Date, now: number): string {
  // A bare weekday is ambiguous once the deadline is a week or more away.
  const dayPart = date.getTime() - now < WEEK_MS ? format(date, 'EEEE') : format(date, 'EEE, MMM d');
  return `Closes ${dayPart} at ${format(date, 'h:mm a')}`;
}

function formatRelative(date: Date): string {
  return `in ${formatDistanceToNow(date)}`;
}

function urgencyClasses(soon: boolean, expired: boolean): string {
  if (expired) {
    return 'border-red-500/40 bg-red-500/10 text-red-300';
  }
  if (soon) {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  }
  return 'border-edge bg-panel/40 text-foreground';
}

export function PollDeadlineBanner({ phaseDeadline }: Props): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!phaseDeadline) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [phaseDeadline]);

  if (!phaseDeadline) return null;
  const date = new Date(phaseDeadline);
  if (Number.isNaN(date.getTime())) return null;

  const remainingMs = date.getTime() - now;
  const expired = remainingMs <= 0;
  const soon = !expired && remainingMs < SOON_THRESHOLD_MS;
  const absolute = formatAbsolute(date, now);
  const relative = expired ? 'closed' : formatRelative(date);

  return (
    <div
      data-testid="poll-deadline-banner"
      data-soon={soon ? 'true' : 'false'}
      data-expired={expired ? 'true' : 'false'}
      className={`px-4 py-2.5 rounded-lg border text-sm flex items-center gap-2 ${urgencyClasses(soon, expired)}`}
    >
      <span className="font-medium">{absolute}</span>
      <span className="text-xs opacity-80">({relative})</span>
    </div>
  );
}
