/**
 * Wireframe: Voting phase.
 * Demonstrates F-12 (empty-state coaching), F-13 (disabled tooltips),
 * F-14 (waiting empty-state), F-18 (operator readiness signal).
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { GAMES, LINEUP } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import {
  PrimaryCta, SecondaryCta, ConfirmationPill, StatusBanner, CoverThumbnail, VoteBar,
} from '../ui-bits';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function votedCount(persona: Persona): number {
  if (persona === 'invitee-acted') return 3;
  if (persona === 'organizer' || persona === 'admin') return 2;
  return 0;
}

function VotingCoach({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona === 'invitee-not-acted') {
    return (
      <StatusBanner tone="info">
        <strong>You have {LINEUP.maxVotesPerPlayer} votes.</strong> Pick the games you want to play — you can change your votes any time before the deadline.
      </StatusBanner>
    );
  }
  if (persona === 'invitee-acted') {
    return (
      <StatusBanner tone="success">
        <strong>You're all set.</strong> Waiting for the others to vote — currently {LINEUP.totalVoters} of {LINEUP.totalMembers}. We'll notify you when it advances.
      </StatusBanner>
    );
  }
  return null;
}

function OperatorReadiness({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <StatusBanner tone="success">
      <strong>Quorum reached</strong> ({LINEUP.totalVoters}/{LINEUP.totalMembers} voted). Top picks are stable. Advance to Decided when you're ready.
    </StatusBanner>
  );
}

function VoteStatusRow({ persona }: { persona: Persona }): JSX.Element {
  const used = votedCount(persona);
  const max = LINEUP.maxVotesPerPlayer;
  return (
    <div className="flex items-center justify-between gap-4 mb-3 px-4 py-2.5 bg-panel/40 border border-edge rounded-lg">
      <div>
        <p className="text-xs text-muted uppercase tracking-wider">Your votes</p>
        <p className="text-sm text-foreground font-medium">{used} of {max} used</p>
      </div>
      {used >= max && persona !== 'uninvited' && (
        <ConfirmationPill>You've voted</ConfirmationPill>
      )}
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

function OperatorAdvance({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <PrimaryCta>Advance to Decided</PrimaryCta>
      <SecondaryCta>Force tiebreaker</SecondaryCta>
    </div>
  );
}

export function VotingWireframe({ persona, phaseState }: Props): JSX.Element {
  return (
    <>
      <LineupHeader
        persona={persona}
        phaseState={phaseState}
        phaseLabel="Voting"
        phaseIndex={2}
        totalPhases={4}
      />
      <VotingCoach persona={persona} />
      <OperatorReadiness persona={persona} />
      <VoteStatusRow persona={persona} />
      <Leaderboard persona={persona} />
      <OperatorAdvance persona={persona} />
    </>
  );
}
