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
import { LineupHeroMeta } from '../LineupHeroMeta';

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
  //
  // React 18+ "reset state when prop changes" pattern: track previous
  // submittedAt in state, set during render when it changes. Avoids the
  // eslint react-hooks 'setState in effect' warning.
  const [dirty, setDirty] = useState(false);
  const [prevSubmittedAt, setPrevSubmittedAt] = useState(submittedAt);
  if (submittedAt !== prevSubmittedAt) {
    setPrevSubmittedAt(submittedAt);
    if (serverSubmitted) setDirty(false);
  }

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

  // Operator review r10 final 2026-05-20: sticky-pin behavior plus
  // header-coupled auto-hide, BUT auto-hide only kicks in AFTER the
  // wrapper has reached its pinned state. The sentinel is a 1px div
  // above the wrapper; once it scrolls off-screen the IntersectionObserver
  // flips hasPinned true. Before that, the hero is in natural flow and
  // does NOT hide on scroll-down (operator: "hides too early"). After
  // pinning, hero rides along with Header's scrollDir signal — hides
  // with Header on mobile scroll-down, reappears on scroll-up.
  const scrollDir = useScrollDirection();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [hasPinned, setHasPinned] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHasPinned(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  const isHidden = scrollDir === 'down' && hasPinned;

  return (
    <section
      data-testid="voting-composite"
      className="space-y-3"
    >
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      <div
        className={`sticky top-14 z-20 py-3 bg-backdrop md:bg-surface md:rounded-md md:px-3 will-change-transform md:will-change-auto md:translate-y-0 ${
          isHidden ? '-translate-y-[calc(100%+3.5rem)]' : 'translate-y-0'
        }`}
        style={{ transition: 'transform 300ms ease-in-out' }}
      >
        <JourneyHero
          phase="voting"
          active={1}
          tone={hero.tone}
          badge={hero.badge}
          task={hero.task}
          sub={<LineupHeroMeta lineup={lineup} phaseContext={hero.sub} />}
        />
        <div className="flex items-center gap-2 mt-2 px-1">
          <div className="flex-shrink-0">
            <VotesUsedPill used={used} max={max} />
          </div>
          <div className="ml-auto flex-shrink-0">
            <StickyHeroSubmitButton
              submitted={submitted}
              used={used}
              max={max}
              disabled={kind === 'empty' || !canParticipate}
              disabledReason={copy.disabledReason}
              onClick={handleCtaClick}
            />
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
