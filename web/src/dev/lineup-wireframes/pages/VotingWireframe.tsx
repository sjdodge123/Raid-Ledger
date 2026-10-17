/**
 * Wireframe: Voting phase.
 * Hero leads. Body is the leaderboard — the page's primary action surface.
 * Operator's advance/force-tiebreaker actions live as ghost buttons under the list.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { GAMES, LINEUP } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { ConfirmationPill, CoverThumbnail, GhostCta, VoteBar } from '../ui-bits';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function votedCount(persona: Persona): number {
  if (persona === 'invitee-acted') return 3;
  if (persona === 'organizer' || persona === 'admin') return 2;
  return 0;
}

function VoteStatusStrip({ persona }: { persona: Persona }): JSX.Element {
  const used = votedCount(persona);
  const max = LINEUP.maxVotesPerPlayer;
  return (
    <div className="flex items-center justify-between mb-3 text-xs">
      <span className="text-muted">
        Your votes: <span className="text-foreground font-medium">{used}/{max}</span>
      </span>
      {used >= max && persona !== 'uninvited' && <ConfirmationPill>You've voted</ConfirmationPill>}
    </div>
  );
}

function VoteButton({ voted, atLimit, canVote }: { voted: boolean; atLimit: boolean; canVote: boolean }): JSX.Element {
  return (
    <button
      type="button"
      disabled={atLimit || !canVote}
      title={atLimit ? "You've used all 3 votes — unvote one to switch" : undefined}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
        voted
          ? 'bg-emerald-600 text-white border-emerald-500'
          : atLimit || !canVote
            ? 'border-edge text-dim cursor-not-allowed'
            : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10'
      }`}
    >
      {voted ? '✓ Voted' : 'Vote'}
    </button>
  );
}

function VoteRow({ g, rank, persona, max }: {
  g: typeof GAMES[number]; rank: number; persona: Persona; max: number;
}): JSX.Element {
  const used = votedCount(persona);
  const atLimit = used >= max && !g.myVote && persona !== 'uninvited';
  const canVote = persona !== 'uninvited';
  return (
    <li className="flex items-center gap-3 px-4 py-3 border-b border-edge last:border-b-0">
      <span className="text-sm font-semibold text-dim w-6 tabular-nums">#{rank}</span>
      <CoverThumbnail name={g.name} color={g.coverColor} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
        <p className="text-xs text-muted">{g.ownerCount} players own</p>
      </div>
      <div className="w-28 hidden sm:block">
        <VoteBar count={g.voteCount} max={LINEUP.totalMembers} />
      </div>
      <VoteButton voted={!!g.myVote} atLimit={atLimit} canVote={canVote} />
    </li>
  );
}

function Leaderboard({ persona }: { persona: Persona }): JSX.Element {
  return (
    <section className="bg-surface border border-edge rounded-xl overflow-hidden">
      <div className="bg-panel/40 px-4 py-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">Leaderboard</span>
        <span className="text-xs text-muted">Sorted by votes</span>
      </div>
      <ul>
        {GAMES.map((g, i) => (
          <VoteRow key={g.id} g={g} rank={i + 1} persona={persona} max={LINEUP.maxVotesPerPlayer} />
        ))}
      </ul>
    </section>
  );
}

function OperatorTail({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <GhostCta>Force tiebreaker</GhostCta>
      <GhostCta>Cancel lineup</GhostCta>
    </div>
  );
}

function AbortedSnapshot({ persona }: { persona: Persona }): JSX.Element {
  return (
    <div className="opacity-70">
      <p className="text-sm text-muted mb-3">Final leaderboard before the lineup was cancelled.</p>
      <Leaderboard persona={persona} />
    </div>
  );
}

export function VotingWireframe({ persona, phaseState }: Props): JSX.Element {
  const hero = getHeroCopy('voting', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <LineupHeader phaseState={phaseState} phaseLabel="Voting" phaseIndex={2} totalPhases={4} />
      {phaseState === 'aborted' ? (
        <AbortedSnapshot persona={persona} />
      ) : (
        <>
          <VoteStatusStrip persona={persona} />
          <Leaderboard persona={persona} />
          <OperatorTail persona={persona} />
        </>
      )}
    </>
  );
}
