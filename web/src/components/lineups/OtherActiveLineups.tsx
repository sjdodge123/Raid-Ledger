/**
 * Chip row linking to other active lineups besides the banner's primary
 * one (ROK-1065). Mirrors the SchedulingBanner chip pattern so operators
 * can navigate between concurrent lineups without losing them after the
 * banner shifted to a newly created lineup.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LineupSummaryResponseDto } from '@raid-ledger/contract';
import { useActiveLineups } from '../../hooks/use-lineups';

function statusLabel(status: LineupSummaryResponseDto['status']): string {
  switch (status) {
    case 'building':
      return 'Nominating';
    case 'voting':
      return 'Voting';
    case 'decided':
      return 'Decided';
    default:
      return status;
  }
}

function LineupChip({
  lineup,
}: {
  lineup: LineupSummaryResponseDto;
}): JSX.Element {
  return (
    <Link
      data-testid={`other-lineup-chip-${lineup.id}`}
      to={`/community-lineup/${lineup.id}`}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-overlay transition-colors text-sm"
    >
      <span className="text-foreground font-medium truncate max-w-[14rem]">
        {lineup.title}
      </span>
      {lineup.visibility === 'private' && (
        <span className="text-[10px] uppercase tracking-wider text-amber-300">
          Private
        </span>
      )}
      <span className="text-muted text-xs">{statusLabel(lineup.status)}</span>
      <span className="text-emerald-400 text-xs font-medium">Open</span>
    </Link>
  );
}

/**
 * Render chips for every active lineup the viewer can see except
 * `primaryLineupId` (which is already rendered as the banner above).
 */
export function OtherActiveLineups({
  primaryLineupId,
}: {
  primaryLineupId: number;
}): JSX.Element | null {
  const { data: lineups = [] } = useActiveLineups();
  const others = lineups.filter(
    (l) => l.id !== primaryLineupId && l.status !== 'archived',
  );
  if (others.length === 0) return null;
  return (
    <div
      data-testid="other-active-lineups"
      className="mb-6 -mt-4 px-1 flex flex-wrap items-center gap-2"
    >
      <span className="text-xs text-muted uppercase tracking-wider">
        Other active lineups
      </span>
      {others.map((l) => (
        <LineupChip key={l.id} lineup={l} />
      ))}
    </div>
  );
}
