import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

interface Props {
  lineup: LineupDetailResponseDto;
}

const MAX_NOMINATIONS = 20;

function uniqueNominators(entries: LineupDetailResponseDto['entries']): number {
  return new Set(entries.map((e) => e.nominatedBy.id)).size;
}

export function LineupProgressBar({ lineup }: Props): JSX.Element {
  const { user } = useAuth();
  const count = lineup.entries.length;
  const pct = Math.min((count / MAX_NOMINATIONS) * 100, 100);
  const nominators = uniqueNominators(lineup.entries);

  return (
    <div className="rounded-lg border border-edge bg-surface p-3 mb-5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm text-secondary font-medium">Nominations</span>
        <span className="text-sm text-muted">{count} / {MAX_NOMINATIONS} max</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-panel border border-edge overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-xs text-dim">{nominators} member{nominators !== 1 ? 's' : ''} have nominated</span>
        {lineup.status === 'building' && user && isOperatorOrAdmin(user) && (
          <Link to="#" className="text-xs text-emerald-400 font-medium hover:underline">
            Start Voting →
          </Link>
        )}
      </div>
    </div>
  );
}
