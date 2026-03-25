/**
 * Phase countdown component for lineup deadlines (ROK-946).
 * Compact mode: "Building - 23h 15m remaining"
 * Full mode: larger countdown with hours/minutes/seconds
 */
import { useState, useEffect, type JSX } from 'react';

interface Props {
  phaseDeadline: string | null;
  /** When the current phase started (lineup updatedAt). Used to compute % remaining. */
  phaseStartedAt?: string | null;
  status: string;
  compact?: boolean;
}

/** Status label map for display. */
const STATUS_LABELS: Record<string, string> = {
  building: 'Building',
  voting: 'Voting',
  decided: 'Decided',
};

function computeRemaining(deadline: string): number {
  return new Date(deadline).getTime() - Date.now();
}

function formatHumanDuration(ms: number): string {
  if (ms <= 0) return 'Transitioning...';
  const totalMinutes = Math.floor(ms / 60_000);
  const totalHours = Math.floor(ms / 3_600_000);
  const totalDays = Math.floor(ms / 86_400_000);

  if (totalDays >= 7) {
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;
    if (days === 0) return `${weeks}w remaining`;
    return `${weeks}w ${days}d remaining`;
  }
  if (totalDays >= 1) {
    const hours = totalHours % 24;
    if (hours === 0) return `${totalDays}d remaining`;
    return `${totalDays}d ${hours}h remaining`;
  }
  if (totalHours >= 1) {
    const minutes = totalMinutes % 60;
    return `${totalHours}h ${minutes}m remaining`;
  }
  return `${totalMinutes}m remaining`;
}

function formatCompact(ms: number): string {
  return formatHumanDuration(ms);
}

function formatFull(ms: number): string {
  if (ms <= 0) return 'Transitioning...';
  const totalDays = Math.floor(ms / 86_400_000);
  // Show seconds only when under 24h
  if (totalDays >= 1) return formatHumanDuration(ms);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return `${parts.join(' ')} remaining`;
}

/** Hourglass color: green >50%, yellow >20%, red ≤20% of configured duration. */
function hourglassColor(remainingMs: number, deadlineIso: string, startIso?: string | null): string {
  const totalMs = startIso
    ? new Date(deadlineIso).getTime() - new Date(startIso).getTime()
    : 0;
  if (totalMs <= 0) return 'text-emerald-500'; // can't compute, default green
  const pct = Math.max(0, remainingMs) / totalMs;
  if (pct > 0.5) return 'text-emerald-500';
  if (pct > 0.2) return 'text-yellow-500';
  return 'text-red-500';
}

/** Hourglass icon that spins 360° every 5 seconds. */
function HourglassIcon({ colorClass }: { colorClass: string }): JSX.Element {
  return (
    <svg
      className={`w-3.5 h-3.5 ${colorClass} inline-block animate-[hourglass-spin_5s_ease-in-out_infinite]`}
      fill="currentColor" viewBox="0 0 24 24"
    >
      <path d="M6 2v6l4 4-4 4v6h12v-6l-4-4 4-4V2H6zm10 15.5V20H8v-2.5l4-4 4 4zm-4-5.5L8 8.5V4h8v4.5l-4 4z" />
    </svg>
  );
}

function CompactCountdown({ status, deadline, startedAt }: {
  status: string; deadline: string; startedAt?: string | null;
}) {
  const [remaining, setRemaining] = useState(computeRemaining(deadline));

  useEffect(() => {
    const id = setInterval(() => setRemaining(computeRemaining(deadline)), 1_000);
    return () => clearInterval(id);
  }, [deadline]);

  const label = STATUS_LABELS[status] ?? status;
  const color = hourglassColor(remaining, deadline, startedAt);
  return (
    <span className="text-xs text-muted inline-flex items-center gap-1.5">
      <HourglassIcon colorClass={color} />
      {label} - {formatCompact(remaining)}
    </span>
  );
}

function FullCountdown({ status, deadline }: { status: string; deadline: string }) {
  const [remaining, setRemaining] = useState(computeRemaining(deadline));

  useEffect(() => {
    const id = setInterval(() => setRemaining(computeRemaining(deadline)), 1_000);
    return () => clearInterval(id);
  }, [deadline]);

  const label = STATUS_LABELS[status] ?? status;
  return (
    <div className="bg-panel/50 border border-edge/50 rounded-lg px-4 py-3">
      <div className="text-xs text-muted uppercase tracking-wider mb-1">
        {label} Phase
      </div>
      <div className="text-lg font-semibold text-foreground">
        {formatFull(remaining)}
      </div>
    </div>
  );
}

export function PhaseCountdown({ phaseDeadline, phaseStartedAt, status, compact }: Props) {
  if (!phaseDeadline) return null;
  if (compact) return <CompactCountdown status={status} deadline={phaseDeadline} startedAt={phaseStartedAt} />;
  return <FullCountdown status={status} deadline={phaseDeadline} />;
}
