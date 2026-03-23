import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { LineupStatusBadge } from './LineupStatusBadge';

interface Props {
  lineup: LineupDetailResponseDto;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function LineupDetailHeader({ lineup }: Props): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="border-b border-edge pb-4 mb-4">
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={() => navigate(-1)}
          className="text-muted hover:text-foreground transition"
          aria-label="Go back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-display font-bold tracking-wide">Community Lineup</h1>
        <LineupStatusBadge status={lineup.status} />
      </div>
      <p className="text-sm text-muted ml-8">
        {lineup.targetDate ? `For ${formatDate(lineup.targetDate)} · ` : ''}
        Started by {lineup.createdBy.displayName}
      </p>
    </div>
  );
}
