import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LineupDetailResponseDto, LineupStatusDto } from '@raid-ledger/contract';
import { useTransitionLineupStatus } from '../../hooks/use-lineups';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { LineupStatusBadge } from './LineupStatusBadge';
import { PhaseCountdown } from './phase-countdown';
import { PHASES, PHASE_LABELS } from './lineup-phases';
import { toast } from '../../lib/toast';
import { UnlinkedSteamCount } from './UnlinkedSteamCount';
import {
  getDistinctNominatorCount,
  getExpectedVoterCount,
} from '../../lib/lineup-quorum-counts';
import { MarkdownText } from '../ui/markdown-text';
import { EditLineupMetadataModal } from './edit-lineup-metadata-modal';
import { AbortLineupButton } from './AbortLineupButton';
import { PublicShareRow } from './LineupPublicShareRow';
import { PhaseTransitionModal } from './phase-transition-modal';

interface Props {
  lineup: LineupDetailResponseDto;
  /** ROK-1207: when true, the lineup has been aborted via activity log and
   *  the phase breadcrumb's advance/revert pills are disabled. */
  isAborted?: boolean;
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

function PhaseBreadcrumb({ lineup, isAborted, onTiebreakerIntercept }: {
  lineup: LineupDetailResponseDto;
  isAborted: boolean;
  onTiebreakerIntercept?: () => void;
}): JSX.Element {
  const { user } = useAuth();
  const transition = useTransitionLineupStatus();
  // ROK-1207: an aborted lineup is terminal — admin must not be able to
  // revert it back to voting/building. Disable all pills regardless of role.
  const canOperate = !isAborted && isOperatorOrAdmin(user);
  const currentIdx = PHASES.indexOf(lineup.status as LineupStatusDto);
  const [targetIdx, setTargetIdx] = useState<number | null>(null);

  return (
    <div className="flex items-center flex-wrap gap-x-1 gap-y-0.5 text-sm">
      {PHASES.map((p, i) => {
        const isCurrent = i === currentIdx;
        const isClickable = canOperate && (i === currentIdx + 1 || i === currentIdx - 1);

        return (
          <span key={p} className="inline-flex items-center">
            {i > 0 && <span className="text-dim mx-1">→</span>}
            {isClickable ? (
              <button
                type="button"
                onClick={() => setTargetIdx(i)}
                disabled={transition.isPending}
                className="px-1.5 py-0.5 rounded transition-colors text-dim hover:text-foreground hover:bg-overlay/50 disabled:opacity-50"
              >
                {PHASE_LABELS[p]}
              </button>
            ) : (
              <span className={`px-1.5 py-0.5 ${isCurrent ? 'text-emerald-400 font-medium' : 'text-dim'}`}>
                {PHASE_LABELS[p]}
              </span>
            )}
          </span>
        );
      })}
      {targetIdx !== null && (
        <PhaseTransitionModal
          fromStatus={lineup.status as LineupStatusDto}
          toStatus={PHASES[targetIdx]}
          isPending={transition.isPending}
          onCancel={() => setTargetIdx(null)}
          onConfirm={() => {
            const targetStatus = PHASES[targetIdx];
            transition.mutate(
              { lineupId: lineup.id, body: { status: targetStatus } },
              {
                onSuccess: () => {
                  toast.success(`Moved to ${PHASE_LABELS[targetStatus]}`);
                  setTargetIdx(null);
                },
                onError: (err) => {
                  const msg = err instanceof Error ? err.message : '';
                  if (msg.includes('TIEBREAKER_REQUIRED') && onTiebreakerIntercept) {
                    onTiebreakerIntercept();
                    setTargetIdx(null);
                  } else {
                    toast.error(msg || 'Transition failed');
                  }
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}

function PhaseContextInfo({ lineup }: { lineup: LineupDetailResponseDto }): JSX.Element | null {
  if (lineup.status === 'building') {
    // ROK-1253: voter-coverage framing replaces the prior `/20` magic
    // number. For private lineups the denominator is creator + invitees;
    // for public it's community membership.
    const expected = getExpectedVoterCount(lineup);
    const nominators = getDistinctNominatorCount(lineup);
    return (
      <span className="text-xs text-dim" data-testid="nomination-count">
        {lineup.entries.length} games · {nominators} of {expected} voters nominated
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

/**
 * Read-only pill showing which Discord channel lineup embeds post to
 * (ROK-1064). Renders nothing when no override is set.
 */
function ChannelOverrideBadge({
  lineup,
}: {
  lineup: LineupDetailResponseDto;
}): JSX.Element | null {
  if (!lineup.channelOverrideId) return null;
  const name = lineup.channelOverrideName ?? 'unknown-channel';
  return (
    <span
      data-testid="lineup-channel-override-badge"
      className="inline-flex items-center px-1.5 py-0.5 text-xs rounded bg-overlay/40 text-muted"
      title="Lineup embeds post to this channel"
    >
      #{name}
    </span>
  );
}

function EditButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground px-2.5 py-1.5 rounded border border-edge/50 hover:bg-overlay/50 active:bg-overlay transition-colors flex-shrink-0 whitespace-nowrap min-h-[32px]"
      aria-label="Edit lineup metadata"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
      <span className="hidden sm:inline">Edit</span>
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

export function LineupDetailHeader({ lineup, isAborted = false, onTiebreakerIntercept }: Props): JSX.Element {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = useCanEdit(lineup);

  return (
    <div className="border-b border-edge pb-4 mb-4 w-full">
      {/* Row 1: back + title + badge + edit + (desktop-only: breadcrumb + circle) */}
      <div className="flex items-center gap-3 min-w-0 mb-2 md:mb-1">
        <button
          onClick={() => navigate(-1)}
          className="text-muted hover:text-foreground transition flex-shrink-0"
          aria-label="Go back"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1
          className="text-lg font-display font-bold tracking-wide truncate flex-1 min-w-0"
          title={lineup.title}
          data-testid="community-lineup-title"
        >
          {lineup.title}
        </h1>
        <LineupStatusBadge status={lineup.status} />
        {lineup.visibility === 'private' && (
          <span
            data-testid="lineup-private-badge"
            title="Invite-only lineup"
            className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-600/20 text-amber-400 border border-amber-500/40"
          >
            Private
          </span>
        )}
        {canEdit && <EditButton onClick={() => setEditOpen(true)} />}
        <AbortLineupButton lineup={lineup} />
        {/* Desktop-only inline breadcrumb + circle after edit */}
        <div className="hidden md:flex items-center gap-3 flex-shrink-0">
          <PhaseBreadcrumb lineup={lineup} isAborted={isAborted} onTiebreakerIntercept={onTiebreakerIntercept} />
          <PhaseCircle status={lineup.status} />
        </div>
      </div>
      {/* Row 2 (mobile only): breadcrumb + circle */}
      <div className="md:hidden flex items-center gap-2 flex-wrap mb-2 ml-8">
        <PhaseBreadcrumb lineup={lineup} isAborted={isAborted} onTiebreakerIntercept={onTiebreakerIntercept} />
        <PhaseCircle status={lineup.status} />
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
          <ChannelOverrideBadge lineup={lineup} />
        </div>
        {lineup.phaseDeadline && (
          <PhaseCountdown phaseDeadline={lineup.phaseDeadline} phaseStartedAt={lineup.updatedAt} status={lineup.status} compact />
        )}
      </div>
      <PublicShareRow lineup={lineup} />
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
