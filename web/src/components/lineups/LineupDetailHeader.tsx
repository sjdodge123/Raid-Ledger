import { useState, useEffect, useRef, useCallback, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LineupDetailResponseDto, LineupStatusDto } from '@raid-ledger/contract';
import { useTransitionLineupStatus } from '../../hooks/use-lineups';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { LineupStatusBadge } from './LineupStatusBadge';
import { PhaseCountdown } from './phase-countdown';
import { PHASES, PHASE_LABELS } from './lineup-phases';
import { toast } from '../../lib/toast';
import { UnlinkedSteamCount } from './UnlinkedSteamCount';
import { MarkdownText } from '../ui/markdown-text';
import { EditLineupMetadataModal } from './edit-lineup-metadata-modal';

interface Props {
  lineup: LineupDetailResponseDto;
  onTiebreakerIntercept?: () => void;
}

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

const CONFIRM_TIMEOUT = 3_000;

function PhaseBreadcrumb({ lineup, onTiebreakerIntercept }: {
  lineup: LineupDetailResponseDto; onTiebreakerIntercept?: () => void;
}): JSX.Element {
  const { user } = useAuth();
  const transition = useTransitionLineupStatus();
  const canOperate = isOperatorOrAdmin(user);
  const currentIdx = PHASES.indexOf(lineup.status as LineupStatusDto);
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const clearPending = useCallback(() => {
    setPendingIdx(null);
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function handleClick(targetIdx: number) {
    if (!canOperate || transition.isPending) return;
    const diff = targetIdx - currentIdx;
    if (diff !== 1 && diff !== -1) return; // only adjacent phases

    if (pendingIdx === targetIdx) {
      // Second click — execute
      clearPending();
      const targetStatus = PHASES[targetIdx];

      const body: { status: string; decidedGameId?: number | null } = { status: targetStatus };
      transition.mutate(
        { lineupId: lineup.id, body },
        {
          onSuccess: () => toast.success(`Moved to ${PHASE_LABELS[PHASES[targetIdx]]}`),
          onError: (err) => {
            const msg = err instanceof Error ? err.message : '';
            if (msg.includes('TIEBREAKER_REQUIRED') && onTiebreakerIntercept) {
              onTiebreakerIntercept();
            } else {
              toast.error(msg || 'Transition failed');
            }
          },
        },
      );
    } else {
      // First click — show confirmation
      setPendingIdx(targetIdx);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(clearPending, CONFIRM_TIMEOUT);
    }
  }

  return (
    <div className="flex items-center gap-1 text-sm">
      {PHASES.map((p, i) => {
        const isCurrent = i === currentIdx;
        const isClickable = canOperate && (i === currentIdx + 1 || i === currentIdx - 1);
        const isPending = pendingIdx === i;
        const isAdvance = i > currentIdx;

        let label = PHASE_LABELS[p];
        if (isPending) label = isAdvance ? 'Advance?' : 'Revert?';

        return (
          <span key={p} className="inline-flex items-center">
            {i > 0 && <span className="text-dim mx-1">→</span>}
            {isClickable ? (
              <button
                type="button"
                onClick={() => handleClick(i)}
                disabled={transition.isPending}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  isPending
                    ? isAdvance
                      ? 'text-emerald-300 bg-emerald-500/20 font-medium'
                      : 'text-amber-300 bg-amber-500/20 font-medium'
                    : 'text-dim hover:text-foreground hover:bg-overlay/50'
                } disabled:opacity-50`}
              >
                {label}
              </button>
            ) : (
              <span className={`px-1.5 py-0.5 ${isCurrent ? 'text-emerald-400 font-medium' : 'text-dim'}`}>
                {label}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function PhaseContextInfo({ lineup }: { lineup: LineupDetailResponseDto }): JSX.Element | null {
  // Total participants = nominators + voters (unique count provided by API)
  const participants = (lineup.totalVoters ?? 0) + (lineup.status === 'building' ? lineup.entries.length : 0);
  if (lineup.status === 'building') {
    return (
      <span className="text-xs text-dim">
        {lineup.entries.length}/20 nominated · {participants} participated
        {lineup.unlinkedSteamCount > 0 && (
          <> · <UnlinkedSteamCount count={lineup.unlinkedSteamCount} /></>
        )}
      </span>
    );
  }
  if (lineup.status === 'voting') {
    return <span className="text-xs text-dim">{lineup.totalVoters} participated</span>;
  }
  if (lineup.status === 'decided') {
    return <span className="text-xs text-dim">Winner: {lineup.decidedGameName ?? 'TBD'} · {lineup.totalVoters} participated</span>;
  }
  return null;
}

function EditButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-muted hover:text-foreground px-2 py-1 rounded border border-edge/50 hover:bg-overlay/50 transition-colors"
      aria-label="Edit lineup metadata"
    >
      Edit
    </button>
  );
}

function useCanEdit(lineup: LineupDetailResponseDto): boolean {
  const { user } = useAuth();
  if (lineup.status === 'archived') return false;
  if (!user) return false;
  if (isOperatorOrAdmin(user)) return true;
  return user.id === lineup.createdBy.id;
}

export function LineupDetailHeader({ lineup, onTiebreakerIntercept }: Props): JSX.Element {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = useCanEdit(lineup);

  return (
    <div className="border-b border-edge pb-4 mb-4 w-full">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="text-muted hover:text-foreground transition"
            aria-label="Go back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-display font-bold tracking-wide truncate" title={lineup.title}>
            {lineup.title}
          </h1>
          <LineupStatusBadge status={lineup.status} />
          {canEdit && <EditButton onClick={() => setEditOpen(true)} />}
        </div>
        <div className="flex items-center gap-2">
          <PhaseBreadcrumb lineup={lineup} onTiebreakerIntercept={onTiebreakerIntercept} />
          <PhaseCircle status={lineup.status} />
        </div>
      </div>
      {lineup.description && (
        <div className="ml-8 mb-2">
          <MarkdownText text={lineup.description} />
        </div>
      )}
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
      {editOpen && (
        <EditLineupMetadataModal
          lineupId={lineup.id}
          initialTitle={lineup.title}
          initialDescription={lineup.description}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
