/**
 * Banner shown on game detail pages when the game is on an active
 * Community Lineup. Lets users vote directly or navigate to the lineup.
 *
 * Operator review r3 2026-05-19: refactored to use the shared JourneyHero
 * component (with `noRibbon`) so the banner reads as a Cycle-4 hero on the
 * game detail page — same emerald border, tone tokens, badge + task layout,
 * and pill placement as the in-lineup hero. Per-status tone:
 *   - building  → action  (nominate-now CTA)
 *   - voting    → action  (vote-now CTA) / set (you've voted)
 *   - voting + tiebreaker active → set
 *   - decided   → set     (schedule-now CTA)
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLineupBanner, useLineupDetail, useToggleVote } from '../../hooks/use-lineups';
import { useTiebreakerDetail } from '../../hooks/use-tiebreaker';
import { JourneyHero } from '../shared/journey-hero';
import { toast } from '../../lib/toast';

interface Props {
  gameId: number;
}

export function LineupVoteBanner({ gameId }: Props): JSX.Element | null {
  const { data: banner } = useLineupBanner();
  if (!banner) return null;

  const entry = banner.entries.find((e) => e.gameId === gameId);
  if (!entry) return null;

  if (banner.status === 'building') {
    return <NominatedBanner lineupId={banner.id} gameName={entry.gameName} />;
  }

  if (banner.status === 'voting') {
    if (banner.tiebreakerActive) {
      return (
        <TiebreakerOrVotingBanner
          lineupId={banner.id}
          gameId={gameId}
          gameName={entry.gameName}
        />
      );
    }
    return <VotingBanner lineupId={banner.id} gameId={gameId} gameName={entry.gameName} />;
  }

  if (banner.status === 'decided') {
    return (
      <DecidedBanner
        lineupId={banner.id}
        gameName={entry.gameName}
        schedulingEnabled={banner.includeSchedulingPhase !== false}
      />
    );
  }

  return null;
}

/**
 * Routes to the tiebreaker banner when this game is among the tied games,
 * else falls back to the regular voting banner. The lookup is lazy — we
 * only fetch tiebreaker detail when banner.tiebreakerActive is true.
 */
function TiebreakerOrVotingBanner({ lineupId, gameId, gameName }: {
  lineupId: number; gameId: number; gameName: string;
}): JSX.Element {
  const { data: tiebreaker } = useTiebreakerDetail(lineupId);
  const isTiedGame = tiebreaker?.tiedGameIds?.includes(gameId) ?? false;
  if (tiebreaker && isTiedGame && tiebreaker.status === 'active') {
    return (
      <TiebreakerBanner
        lineupId={lineupId}
        gameName={gameName}
        mode={tiebreaker.mode}
        hasEngaged={hasEngaged(tiebreaker)}
      />
    );
  }
  return <VotingBanner lineupId={lineupId} gameId={gameId} gameName={gameName} />;
}

/** Whether the current user has already engaged with the tiebreaker. */
function hasEngaged(
  tiebreaker: NonNullable<ReturnType<typeof useTiebreakerDetail>['data']>,
): boolean {
  if (tiebreaker.mode === 'veto') {
    return tiebreaker.vetoStatus?.myVetoGameId != null;
  }
  // Bracket: engaged when every active matchup has a myVote
  const matchups = tiebreaker.matchups ?? [];
  if (matchups.length === 0) return false;
  return matchups.every((m) => m.isCompleted || m.myVote != null);
}

/**
 * Hero-styled banner with primary + secondary action buttons.
 *
 * Layout mirrors the Sv voting composite's sticky hero: JourneyHero on top
 * (noRibbon — the game-detail page is not a lineup-phase surface so the
 * 4-step ribbon would lie), then a horizontal action row immediately below
 * the toolbar with mobile-friendly tap targets (44px mobile / 36px desktop).
 *
 * Primary action uses the emerald-solid chrome shared with the Sv composite's
 * StickyHeroSubmitButton / Nominating's StickyHeroSearchButton, so the entire
 * site reads as one button family. The secondary "View Lineup" is a ghost
 * outline using the same dimensions.
 */
const PRIMARY_BTN_CLS =
  'flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-sm font-semibold text-white shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
const SECONDARY_BTN_CLS =
  'flex-1 sm:flex-initial min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-md border border-edge bg-overlay/30 hover:bg-overlay/50 active:bg-overlay/70 text-sm font-semibold text-foreground transition-colors whitespace-nowrap';

function BannerHero({
  phase,
  active,
  tone,
  badge,
  task,
  sub,
  primaryLabel,
  primaryDisabled,
  onPrimaryClick,
  secondaryLabel,
  onSecondaryClick,
}: {
  phase: 'nominating' | 'voting' | 'decided';
  active: 0 | 1 | 2;
  tone: 'action' | 'set' | 'waiting';
  badge: string;
  task: string;
  sub?: string;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  onPrimaryClick?: () => void;
  secondaryLabel: string;
  onSecondaryClick: () => void;
}): JSX.Element {
  return (
    <div className="mb-6">
      <JourneyHero
        phase={phase}
        active={active}
        tone={tone}
        badge={badge}
        task={task}
        sub={sub}
        noRibbon
      />
      <div className="flex items-center gap-2 mt-2 px-1">
        {primaryLabel && onPrimaryClick && (
          <button
            type="button"
            onClick={onPrimaryClick}
            disabled={primaryDisabled}
            className={PRIMARY_BTN_CLS}
          >
            {primaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onSecondaryClick}
          /* When the banner has no primary action (e.g. Nominated /
             Decided / Tiebreaker variants), promote the secondary to the
             primary style — operator review r10d 2026-05-20. */
          className={
            primaryLabel && onPrimaryClick ? SECONDARY_BTN_CLS : PRIMARY_BTN_CLS
          }
        >
          <span>{secondaryLabel}</span>
        </button>
      </div>
    </div>
  );
}

function NominatedBanner({ lineupId, gameName }: { lineupId: number; gameName: string }): JSX.Element {
  const navigate = useNavigate();
  return (
    <BannerHero
      phase="nominating"
      active={0}
      tone="action"
      badge="Community Lineup · Nominating"
      task={`${gameName} is nominated for the next group game.`}
      sub="View the lineup to see who else is nominated and add your own picks."
      secondaryLabel="View Lineup →"
      onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
    />
  );
}



function VotingBanner({ lineupId, gameId, gameName }: {
  lineupId: number; gameId: number; gameName: string;
}): JSX.Element {
  const { data: detail } = useLineupDetail(lineupId);
  const voteMutation = useToggleVote();
  const navigate = useNavigate();
  const hasVoted = detail?.myVotes?.includes(gameId) ?? false;
  const isVoting = voteMutation.isPending;

  const handleVote = (): void => {
    voteMutation.mutate(
      { lineupId, gameId },
      {
        onSuccess: (data) => {
          const stillVoted = data.myVotes?.includes(gameId) ?? false;
          toast.success(stillVoted ? 'Vote recorded' : 'Vote removed');
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Vote failed'),
      },
    );
  };

  return (
    <BannerHero
      phase="voting"
      active={1}
      tone={hasVoted ? 'set' : 'action'}
      badge="Community Lineup · Voting"
      task={`${gameName} is up for a vote!`}
      sub={hasVoted ? "You've voted for this game." : 'Cast your vote or view the lineup.'}
      primaryLabel={isVoting ? 'Saving…' : hasVoted ? '✓ Voted' : 'Vote'}
      primaryDisabled={isVoting}
      onPrimaryClick={handleVote}
      secondaryLabel="View Lineup →"
      onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
    />
  );
}

function TiebreakerBanner({ lineupId, gameName, mode, hasEngaged }: {
  lineupId: number; gameName: string; mode: 'bracket' | 'veto'; hasEngaged: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const cta = mode === 'veto' ? 'Cast your veto' : 'Vote in bracket';
  const action = mode === 'veto' ? 'veto tiebreaker' : 'bracket tiebreaker';
  return (
    <BannerHero
      phase="voting"
      active={1}
      tone="set"
      badge="Community Lineup · Tiebreaker"
      task={`${gameName} is in a ${action}.`}
      sub={
        hasEngaged
          ? "You've already cast your vote in this tiebreaker."
          : `${cta} to break the tie.`
      }
      secondaryLabel={hasEngaged ? 'View Lineup →' : `${cta} →`}
      onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
    />
  );
}

function DecidedBanner({
  lineupId,
  gameName,
  schedulingEnabled,
}: {
  lineupId: number;
  gameName: string;
  schedulingEnabled: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  // ROK-1302: terminal copy when the lineup opted out of the scheduling phase.
  return (
    <BannerHero
      phase="decided"
      active={2}
      tone="set"
      badge="Community Lineup · Decided"
      task={
        schedulingEnabled
          ? `${gameName} matched — schedule a time to play.`
          : `${gameName} won this lineup.`
      }
      sub={
        schedulingEnabled
          ? 'View the lineup to lock in a time.'
          : 'View the lineup for the full results.'
      }
      secondaryLabel="View Lineup →"
      onSecondaryClick={() => navigate(`/community-lineup/${lineupId}`)}
    />
  );
}
