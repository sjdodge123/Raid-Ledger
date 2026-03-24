/**
 * Phase countdown component for lineup deadlines (ROK-946).
 * Compact mode: "Building - 23h 15m remaining"
 * Full mode: larger countdown with hours/minutes/seconds
 */
import { useState, useEffect } from 'react';

interface Props {
  phaseDeadline: string | null;
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

function formatCompact(ms: number): string {
  if (ms <= 0) return 'Transitioning...';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

function formatFull(ms: number): string {
  if (ms <= 0) return 'Transitioning...';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return `${parts.join(' ')} remaining`;
}

function CompactCountdown({ status, deadline }: { status: string; deadline: string }) {
  const [remaining, setRemaining] = useState(computeRemaining(deadline));

  useEffect(() => {
    const id = setInterval(() => setRemaining(computeRemaining(deadline)), 1_000);
    return () => clearInterval(id);
  }, [deadline]);

  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className="text-xs text-muted">
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

export function PhaseCountdown({ phaseDeadline, status, compact }: Props) {
  if (!phaseDeadline) return null;
  if (compact) return <CompactCountdown status={status} deadline={phaseDeadline} />;
  return <FullCountdown status={status} deadline={phaseDeadline} />;
}
