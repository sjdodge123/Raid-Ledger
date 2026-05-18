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
import { useMemo, useState, type JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { JourneyHero } from '../../shared/journey-hero';
import { SubmitBar } from '../../shared/submit-bar/SubmitBar';
import { deriveSubmitKind, type SubmitKind } from '../../shared/submit-bar/derive-kind';
import { useToggleVote } from '../../../hooks/use-lineups';
import { useSubmitVotes } from '../../../hooks/use-lineup-submit';
import { GameResearchDrawer } from '../../games/GameResearchDrawer';
import { toast } from '../../../lib/toast';
import { VotesUsedPill } from './VotesUsedPill';
import { VotingLeaderboardV2 } from './VotingLeaderboardV2';

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
): { badge: string; task: string; sub: string; tone: 'action' | 'waiting' } {
  const badge = 'Step 2 of 4 · Voting';
  if (submitted) {
    return {
      badge,
      task: "You're done voting.",
      sub: `Waiting on the rest of the group · ${lineup.totalVoters} of ${lineup.votingEligibleCount} have voted`,
      tone: 'waiting',
    };
  }
  return {
    badge,
    task: 'Pick the games you want to play.',
    sub: `${lineup.totalVoters} of ${lineup.votingEligibleCount} have voted so far.`,
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
  const submitted = submittedAt != null;

  const kind = deriveSubmitKind({
    submittedAt,
    hasAnyAction: used > 0,
    hasFullAction: atLimit,
  });
  const copy = submitBarCopy(kind, used, max);
  const hero = buildHero(lineup, submitted);

  const handleToggle = (gameId: number): void => {
    if (!canParticipate) return;
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

  const handleSubmit = (): void => {
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

  return (
    <section
      data-testid="voting-composite"
      className="space-y-3"
    >
      <JourneyHero
        phase="voting"
        active={1}
        tone={hero.tone}
        badge={hero.badge}
        task={hero.task}
        sub={hero.sub}
      />
      <div className="flex justify-end">
        <VotesUsedPill used={used} max={max} />
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
      <SubmitBar
        kind={kind}
        status={copy.status}
        cta={copy.cta}
        nudge={copy.nudge}
        disabledReason={copy.disabledReason}
        onCtaClick={handleSubmit}
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
