/**
 * Wireframe: Decided phase.
 * Demonstrates F-19/F-21 — single "Your next step" rollup over the 3-tier matrix.
 * (Direct overlap with ROK-1119 scope.)
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { GAMES, MATCHES } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import {
  PrimaryCta, SecondaryCta, GhostCta, StatusBanner, CoverThumbnail, VoteBar, ConfirmationPill,
} from '../ui-bits';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function nextStep(persona: Persona): { tone: 'success' | 'info' | 'amber'; copy: string; cta: string | null } {
  switch (persona) {
    case 'invitee-not-acted':
      return { tone: 'info', copy: 'Hollowforge has the votes to schedule. Want in?', cta: 'Join Hollowforge' };
    case 'invitee-acted':
      return { tone: 'success', copy: "Your top pick won — Hollowforge is ready to schedule.", cta: 'Schedule Hollowforge' };
    case 'organizer':
      return { tone: 'amber', copy: '2 matches ready to schedule, 1 needs 1 more player.', cta: 'Review matches' };
    case 'admin':
      return { tone: 'amber', copy: 'Voting closed. Operator action: schedule top match or advance lineup to archive.', cta: 'Open scheduling' };
    case 'uninvited':
      return { tone: 'info', copy: 'Voting is closed. Request an invite to join a future lineup.', cta: null };
  }
}

function NextStepCard({ persona }: { persona: Persona }): JSX.Element {
  const { tone, copy, cta } = nextStep(persona);
  return (
    <StatusBanner tone={tone}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p><strong>Your next step:</strong> {copy}</p>
        {cta && <PrimaryCta>{cta}</PrimaryCta>}
      </div>
    </StatusBanner>
  );
}

function Podium(): JSX.Element {
  const top3 = GAMES.slice(0, 3);
  return (
    <section className="grid grid-cols-3 gap-3 mb-6" aria-label="Voting podium">
      {top3.map((g, i) => {
        const place = ['1st', '2nd', '3rd'][i];
        return (
          <div key={g.id} className="bg-panel/50 border border-edge rounded-lg p-3 text-center" data-testid={`podium-${i + 1}`}>
            <CoverThumbnail name={g.name} color={g.coverColor} size="lg" />
            <p className="text-xs uppercase tracking-wider text-muted mt-2">{place}</p>
            <p className="text-sm font-semibold text-foreground truncate">{g.name}</p>
            <p className="text-xs text-muted">{g.voteCount} votes</p>
          </div>
        );
      })}
    </section>
  );
}

function MatchCard({ m, persona }: { m: typeof MATCHES[number]; persona: Persona }): JSX.Element {
  const tier = m.voteCount >= 6 ? 'Scheduling now' : m.members.length >= m.threshold ? 'Almost there' : 'Rally your crew';
  const cta = tier === 'Scheduling now'
    ? 'Schedule this →'
    : tier === 'Almost there'
      ? 'Join this match'
      : "I'm interested";
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
    <section className="mt-6">
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
    <div className="mt-4 flex flex-wrap gap-2">
      <ConfirmationPill>You voted for 3 games</ConfirmationPill>
      <ConfirmationPill>You're in 2 matches</ConfirmationPill>
    </div>
  );
}

function OperatorTools({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mt-6 flex flex-wrap gap-2 border-t border-edge pt-4">
      <SecondaryCta>Archive lineup</SecondaryCta>
      <GhostCta>Share results</GhostCta>
      <GhostCta>Cancel lineup</GhostCta>
    </div>
  );
}

export function DecidedWireframe({ persona, phaseState }: Props): JSX.Element {
  return (
    <>
      <LineupHeader
        persona={persona}
        phaseState={phaseState}
        phaseLabel="Decided"
        phaseIndex={3}
        totalPhases={4}
      />
      <NextStepCard persona={persona} />
      <Podium />
      <ParticipationRollup persona={persona} />
      <MatchesGrid persona={persona} />
      <OperatorTools persona={persona} />
    </>
  );
}
