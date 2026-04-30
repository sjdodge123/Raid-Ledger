/**
 * Wireframe: Decided phase.
 * Hero leads. Body focuses on the matches grid (the action surface).
 * Vote results collapsed to a <details>.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { GAMES, MATCHES } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { ConfirmationPill, CoverThumbnail, GhostCta, VoteBar } from '../ui-bits';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function PodiumCollapsed(): JSX.Element {
  const top3 = GAMES.slice(0, 3);
  return (
    <details className="mb-4 text-sm text-secondary border-b border-edge/40 pb-3">
      <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted hover:text-foreground">
        Vote results · top {top3.length}
      </summary>
      <ol className="mt-2 grid grid-cols-3 gap-2 text-center">
        {top3.map((g, i) => (
          <li key={g.id} className="bg-panel/30 border border-edge/40 rounded p-2">
            <CoverThumbnail name={g.name} color={g.coverColor} size="sm" />
            <p className="text-[11px] uppercase tracking-wider text-dim mt-1">{['1st','2nd','3rd'][i]}</p>
            <p className="text-xs text-foreground truncate">{g.name}</p>
            <p className="text-[10px] text-muted">{g.voteCount} votes</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

function MatchCard({ m, persona }: { m: typeof MATCHES[number]; persona: Persona }): JSX.Element {
  const tier = m.voteCount >= 6 ? 'Scheduling now' : m.members.length >= m.threshold ? 'Almost there' : 'Rally your crew';
  const cta = tier === 'Scheduling now' ? 'Schedule this →' : tier === 'Almost there' ? 'Join this match' : "I'm interested";
  return (
    <article className="bg-surface border border-edge rounded-lg p-3" data-testid="match-card">
      <div className="flex items-center gap-3 mb-2">
        <CoverThumbnail name={m.gameName} color={m.coverColor} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{m.gameName}</p>
          <p className="text-xs text-dim uppercase tracking-wider">{tier}</p>
        </div>
      </div>
      <div className="mb-2">
        <VoteBar count={m.members.length} max={m.threshold} color="bg-cyan-500" />
        <p className="text-[11px] text-muted mt-1">{m.members.length} of {m.threshold} players ready</p>
      </div>
      <button
        type="button"
        disabled={persona === 'uninvited'}
        className="w-full py-1.5 text-xs font-medium text-emerald-300 bg-emerald-600/20 border border-emerald-500/30 rounded hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
      >
        {cta}
      </button>
    </article>
  );
}

function MatchesGrid({ persona }: { persona: Persona }): JSX.Element {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Matches</h3>
        <span className="text-xs text-muted">3 tiers — scheduling / almost there / rally</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MATCHES.map((m) => <MatchCard key={m.id} m={m} persona={persona} />)}
      </div>
    </section>
  );
}

function ParticipationRollup({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'invitee-acted') return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <ConfirmationPill>You voted for 3 games</ConfirmationPill>
      <ConfirmationPill>You're in 2 matches</ConfirmationPill>
    </div>
  );
}

function OperatorTail({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <GhostCta>Archive lineup</GhostCta>
      <GhostCta>Share results</GhostCta>
    </div>
  );
}

function AbortedSnapshot(): JSX.Element {
  return (
    <div className="opacity-70">
      <p className="text-sm text-muted mb-3">Final podium and matches preserved before the lineup was cancelled.</p>
      <PodiumCollapsed />
    </div>
  );
}

export function DecidedWireframe({ persona, phaseState }: Props): JSX.Element {
  const hero = getHeroCopy('decided', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <LineupHeader phaseState={phaseState} phaseLabel="Decided" phaseIndex={3} totalPhases={4} />
      {phaseState === 'aborted' ? (
        <AbortedSnapshot />
      ) : (
        <>
          <ParticipationRollup persona={persona} />
          <MatchesGrid persona={persona} />
          <PodiumCollapsed />
          <OperatorTail persona={persona} />
        </>
      )}
    </>
  );
}
