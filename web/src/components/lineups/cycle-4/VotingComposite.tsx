/**
 * Sv Voting composite (ROK-1298) — top-level component for the voting
 * phase of a lineup. Replaces the legacy `VotingLeaderboard` +
 * `LeaderboardRow` triad with the Cycle 4 unified hierarchy:
 *
 *     JourneyHero (U1)
 *     VotesUsedPill (this folder)
 *     VotingLeaderboardV2 → VotingRow → VoteToggleButton (this folder)
 *     SubmitBar (U4)
 *     GameResearchDrawer (U2, conditionally mounted)
 *
 * Per-spec deltas:
 *   - Vote bars normalized to `lineup.votingEligibleCount` (NOT
 *     `totalVoters`) — fixes the "1 vote = 100%" bar bug.
 *   - Vote toggle has `aria-label="Vote for {gameName}"` + `aria-pressed`
 *     — fixes the legacy "(no name)" a11y violation.
 *   - Submit ritual added (U4 SubmitBar) — empty / partial / pre / post.
 *
 * State ownership:
 *   - Server state: lineup detail (passed in as a prop from
 *     `LineupDetailBody`), votes (`useToggleVote`), submit timestamp
 *     (`useSubmitVotes`).
 *   - Client state: drawer-game-id (which entry's drawer is open).
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { deriveSubmitKind, type SubmitKind } from '../../shared/submit-bar/derive-kind';
import { useToggleVote } from '../../../hooks/use-lineups';
import { useSubmitVotes } from '../../../hooks/use-lineup-submit';
import { useScrollDirection } from '../../../hooks/use-scroll-direction';
import { GameResearchDrawer } from '../../games/GameResearchDrawer';
import { toast } from '../../../lib/toast';
import { VotesUsedPill } from './VotesUsedPill';
import { VotingLeaderboardV2 } from './VotingLeaderboardV2';
import { StickyHeroSubmitButton } from './sticky-hero-buttons';

/** Props for {@link VotingComposite}. */
export interface VotingCompositeProps {
  /** Full lineup detail (passed down from `LineupDetailBody`). */
  lineup: LineupDetailResponseDto;
  /** False for private non-invitees — every interaction is disabled. */
  canParticipate: boolean;
}

interface SubmitBarCopy {
  status: string;
  cta: string;
  disabledReason: string | undefined;
  nudge: string | undefined;
}

/** Resolve the SubmitBar's status + CTA copy from kind + counts. */
function submitBarCopy(
  kind: SubmitKind,
  used: number,
  max: number,
): SubmitBarCopy {
  if (kind === 'post') {
    return {
      status: `Locked in · ${used}/${max} submitted`,
      cta: 'Change my votes',
      disabledReason: undefined,
      nudge: undefined,
    };
  }
  if (kind === 'pre') {
    return {
      status: `Autosaved — ready to submit ${used}/${max}`,
      cta: 'Submit my votes →',
      disabledReason: undefined,
      nudge: undefined,
    };
  }
  if (kind === 'partial') {
    return {
      status: `Autosaved — ${used}/${max} selected`,
      cta: 'Submit my votes →',
      disabledReason: undefined,
      nudge: `${max - used} vote${max - used === 1 ? '' : 's'} still available`,
    };
  }
  return {
    status: 'Cast at least one vote first',
    cta: 'Submit my votes →',
    disabledReason: 'cast at least one vote first',
    nudge: undefined,
  };
}

/** Resolve the JourneyHero badge + task copy. */
function buildHero(
  lineup: LineupDetailResponseDto,
  submitted: boolean,
  used: number,
  max: number,
): { badge: string; task: string; sub: string; tone: 'action' | 'waiting' } {
  const badge = 'Step 2 of 4 · Voting';
  const voters = `${lineup.totalVoters} of ${lineup.votingEligibleCount} voters have weighed in`;
  if (submitted) {
    return {
      badge,
      task: "You're done voting.",
      sub: `Waiting on the rest of the group · ${voters}.`,
      tone: 'waiting',
    };
  }
  return {
    badge,
    task: 'Pick the games you want to play.',
    sub: `You've voted on ${used} of ${max}. ${voters}.`,
    tone: 'action',
  };
}

/** Sv Voting composite — see file-level docstring. */
export function VotingComposite(props: VotingCompositeProps): JSX.Element {
  const { lineup, canParticipate } = props;
  const [drawerGameId, setDrawerGameId] = useState<number | null>(null);
  const toggleVote = useToggleVote();
  const submitVotes = useSubmitVotes();

  const myVotes = useMemo(() => lineup.myVotes ?? [], [lineup.myVotes]);
  const max = lineup.maxVotesPerPlayer ?? 3;
  const used = myVotes.length;
  const atLimit = used >= max;
  const submittedAt = lineup.viewerSubmissions?.votesSubmittedAt ?? null;
  const serverSubmitted = submittedAt != null;

  // Local "dirty since submit" flag. Two triggers:
  //   1. User clicks "Change my votes" while in `post` state (explicit unlock).
  //   2. User toggles a vote while submitted (implicit unlock — they're
  //      actively editing again so the SubmitBar should re-arm).
  // Reset to `false` whenever a fresh submittedAt arrives from the server
  // (post-submit) so re-submitting locks the state back in.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (serverSubmitted) setDirty(false);
  }, [submittedAt, serverSubmitted]);

  const submitted = serverSubmitted && !dirty;
  const effectiveSubmittedAt = submitted ? submittedAt : null;

  const kind = deriveSubmitKind({
    submittedAt: effectiveSubmittedAt,
    hasAnyAction: used > 0,
    hasFullAction: atLimit,
  });
  const copy = submitBarCopy(kind, used, max);
  const hero = buildHero(lineup, submitted, used, max);

  const handleToggle = (gameId: number): void => {
    if (!canParticipate) return;
    // Implicit unlock — vote toggle after submit re-arms the SubmitBar.
    if (serverSubmitted) setDirty(true);
    toggleVote.mutate(
      { lineupId: lineup.id, gameId },
      {
        onSuccess: (data) => {
          const stillVoted = data.myVotes?.includes(gameId) ?? false;
          toast.success(stillVoted ? 'Vote recorded' : 'Vote removed');
        },
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : 'Vote failed'),
      },
    );
  };

  const handleCtaClick = (): void => {
    if (kind === 'post') {
      // Explicit unlock — "Change my votes" flips back to editable without
      // hitting the server. User can now toggle votes; when they Submit
      // again, the server re-stamps viewerSubmissions.votesSubmittedAt.
      setDirty(true);
      return;
    }
    submitVotes.mutate(
      { lineupId: lineup.id },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : 'Submit failed',
          ),
      },
    );
  };

  // Sticky-hero scroll behavior (mirrors NominatingComposite ROK-1297 round 5g).
  // Sentinel divs gate the hide-on-scroll-down via IntersectionObserver so we
  // don't leave a ghost slot in document flow before the wrapper actually
  // pins to top:14.
  const scrollDir = useScrollDirection();
  const stuckSentinelRef = useRef<HTMLDivElement | null>(null);
  const [isStuck, setIsStuck] = useState(false);
  useEffect(() => {
    const sentinel = stuckSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  const heroHidden = scrollDir === 'down' && isStuck;

  return (
    <section
      data-testid="voting-composite"
      className="space-y-3"
    >
      <div ref={stuckSentinelRef} aria-hidden="true" className="h-px" />
      {/*
       * Operator review r5 2026-05-20: collapse the wrapper's height when
       * hiding (instead of just translate-y) so the rows below don't sit
       * 200px lower than the visible viewport. Sticky-pinned elements
       * reserve their full height in the layout slot — translate-y only
       * moves the paint, not the slot. Combining max-height + opacity
       * removes both the paint AND the slot, so the leaderboard rows
       * scroll up to fill the space cleanly.
       */}
      <div
        className={`sticky top-14 z-20 bg-surface rounded-md px-3 md:max-h-none md:opacity-100 md:py-3 overflow-hidden ${
          heroHidden ? 'max-h-0 opacity-0 py-0' : 'max-h-[500px] opacity-100 py-3'
        }`}
      >
        <JourneyHero
          phase="voting"
          active={1}
          tone={hero.tone}
          badge={hero.badge}
          task={hero.task}
          sub={hero.sub}
        />
        <div className="flex items-center gap-2 mt-2 px-1">
          <StickyHeroSubmitButton
            submitted={submitted}
            used={used}
            max={max}
            disabled={kind === 'empty' || !canParticipate}
            disabledReason={copy.disabledReason}
            onClick={handleCtaClick}
          />
          <div className="ml-auto flex-shrink-0">
            <VotesUsedPill used={used} max={max} />
          </div>
        </div>
        {copy.nudge && (
          <p className="mt-1 px-1 text-[11px] text-muted italic">
            {copy.nudge}
          </p>
        )}
      </div>
      {!canParticipate && (
        <p
          data-testid="voting-private-notice"
          className="text-xs text-amber-400"
        >
          Private lineup — ask the creator for an invite to cast votes.
        </p>
      )}
      <VotingLeaderboardV2
        entries={lineup.entries}
        myVotes={myVotes}
        voterDenominator={lineup.votingEligibleCount}
        atLimit={atLimit}
        canParticipate={canParticipate}
        onToggleVote={handleToggle}
        onOpenDrawer={(id) => setDrawerGameId(id)}
      />
      {drawerGameId != null && (
        <GameResearchDrawer
          isOpen={true}
          gameId={drawerGameId}
          onClose={() => setDrawerGameId(null)}
        />
      )}
    </section>
  );
}
