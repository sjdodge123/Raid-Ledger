import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LineupDetailResponseDto, LineupStatusDto } from '@raid-ledger/contract';
import { LineupStatusBadge } from './LineupStatusBadge';
import { PhaseCountdown } from './phase-countdown';

interface Props {
  lineup: LineupDetailResponseDto;
  actions?: JSX.Element | null;
}

const PHASES: LineupStatusDto[] = ['building', 'voting', 'decided', 'archived'];
const PHASE_LABELS: Record<LineupStatusDto, string> = {
  building: 'Nominating', voting: 'Voting', decided: 'Decided', archived: 'Archived',
};

/** SVG circle progress indicator — fills 33/66/100% with red→yellow→green. */
function PhaseCircle({ status }: { status: string }): JSX.Element {
  const idx = PHASES.indexOf(status as LineupStatusDto);
  // building=0 → 33%, voting=1 → 66%, decided/archived=2/3 → 100%
  const pct = idx <= 0 ? 33 : idx === 1 ? 66 : 100;
  const color = pct <= 33 ? '#ef4444' : pct <= 66 ? '#eab308' : '#22c55e';
  const r = 8;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="flex-shrink-0">
      <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-zinc-700" />
      <circle cx="11" cy="11" r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 11 11)" />
    </svg>
  );
}

function PhaseBreadcrumb({ status }: { status: string }): JSX.Element {
  const current = PHASES.indexOf(status as LineupStatusDto);
  return (
    <span className="text-[11px] text-dim">
      {PHASES.map((p, i) => (
        <span key={p} className={i === current ? 'text-emerald-400 font-medium' : ''}>
          {i > 0 && ' → '}{PHASE_LABELS[p]}
        </span>
      ))}
    </span>
  );
}

function PhaseContextInfo({ lineup }: { lineup: LineupDetailResponseDto }): JSX.Element | null {
  // Total participants = nominators + voters (unique count provided by API)
  const participants = (lineup.totalVoters ?? 0) + (lineup.status === 'building' ? lineup.entries.length : 0);
  if (lineup.status === 'building') {
    return <span className="text-xs text-dim">{lineup.entries.length}/20 nominated · {participants} participated</span>;
  }
  if (lineup.status === 'voting') {
    return <span className="text-xs text-dim">{lineup.totalVoters} participated</span>;
  }
  if (lineup.status === 'decided') {
    return <span className="text-xs text-dim">Winner: {lineup.decidedGameName ?? 'TBD'} · {lineup.totalVoters} participated</span>;
  }
  return null;
}

export function LineupDetailHeader({ lineup, actions }: Props): JSX.Element {
  const navigate = useNavigate();

  return (
    <div className="border-b border-edge pb-4 mb-4 w-full">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
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
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <PhaseBreadcrumb status={lineup.status} />
            <PhaseCircle status={lineup.status} />
          </div>
          {actions}
        </div>
      </div>
      <div className="flex items-center justify-between ml-8">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className="text-muted">Started by {lineup.createdBy.displayName}</span>
          <span className="text-dim">·</span>
          <PhaseContextInfo lineup={lineup} />
        </div>
        {lineup.phaseDeadline && (
          <PhaseCountdown phaseDeadline={lineup.phaseDeadline} phaseStartedAt={lineup.updatedAt} status={lineup.status} compact />
        )}
      </div>
    </div>
  );
}
