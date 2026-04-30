/**
 * Wireframe: standalone scheduling poll page.
 * Demonstrates F-33 (recommended-default), F-34 (vote pill rollup),
 * F-35 (quorum celebration), F-36 (deadline display),
 * F-37 (back-to-lineup breadcrumb), F-38 (cancel-poll confirm).
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { SLOTS, LINEUP } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import {
  PrimaryCta, SecondaryCta, GhostCta, ConfirmationPill, StatusBanner, VoteBar,
} from '../ui-bits';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function MatchContextCard(): JSX.Element {
  return (
    <section className="mb-4 p-4 bg-panel/40 border border-edge rounded-lg">
      <p className="text-xs uppercase tracking-wider text-muted">Scheduling</p>
      <h3 className="text-base font-semibold text-foreground mt-1">Hollowforge — Saturday Night Crew</h3>
      <p className="text-sm text-secondary mt-1">{SLOTS.length} time slots proposed · 5 of {LINEUP.totalMembers} members voted</p>
    </section>
  );
}

function QuorumBanner({ phaseState }: { phaseState: PhaseState }): JSX.Element | null {
  if (phaseState === 'aborted' || phaseState === 'phase-complete') return null;
  return (
    <StatusBanner tone="success">
      <strong>Quorum reached at Sat 7:00 PM.</strong> 5 voters have agreed — schedule it now or wait for more.
    </StatusBanner>
  );
}

function ReadOnlyReason({ phaseState }: { phaseState: PhaseState }): JSX.Element | null {
  if (phaseState !== 'phase-complete') return null;
  return (
    <StatusBanner tone="info">
      <strong>Poll complete.</strong> Voting closed because quorum was reached. The event is on the calendar.
      {' '}
      <button type="button" className="underline ml-1">View event →</button>
    </StatusBanner>
  );
}

function CompletedActions({ phaseState }: { phaseState: PhaseState }): JSX.Element | null {
  if (phaseState !== 'phase-complete') return null;
  return (
    <div className="flex gap-2 mb-4">
      <PrimaryCta>View event</PrimaryCta>
      <SecondaryCta>← Back to lineup</SecondaryCta>
    </div>
  );
}

function SlotLabel({ s }: { s: typeof SLOTS[number] }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <p className="text-sm font-medium text-foreground">{s.label}</p>
      {s.isQuorum && (
        <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          Quorum
        </span>
      )}
    </div>
  );
}

function SlotRow({ s, persona }: { s: typeof SLOTS[number]; persona: Persona }): JSX.Element {
  const canVote = persona !== 'uninvited';
  return (
    <li className="flex items-center gap-3 px-4 py-3 border-b border-edge last:border-b-0">
      <div className="flex-1 min-w-0"><SlotLabel s={s} /></div>
      <div className="w-32">
        <VoteBar count={s.votes} max={LINEUP.totalMembers} color="bg-cyan-500" />
      </div>
      <button
        type="button"
        disabled={!canVote}
        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
          s.myVote
            ? 'bg-emerald-600 text-white border-emerald-500'
            : 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50'
        }`}
      >
        {s.myVote ? '✓ Voted' : 'Vote'}
      </button>
    </li>
  );
}

function ParticipationRollup({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'invitee-acted') return null;
  const myVotes = SLOTS.filter((s) => s.myVote).length;
  return (
    <div className="mb-3"><ConfirmationPill>You voted on {myVotes} time slots</ConfirmationPill></div>
  );
}

function SlotList({ persona }: { persona: Persona }): JSX.Element {
  return (
    <section className="bg-surface border border-edge rounded-xl overflow-hidden mb-4">
      <div className="bg-panel/40 px-4 py-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">Suggested times</span>
      </div>
      <ul>
        {SLOTS.map((s) => <SlotRow key={s.id} s={s} persona={persona} />)}
      </ul>
    </section>
  );
}

function SuggestSection({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona === 'uninvited') return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <input
        type="datetime-local"
        className="bg-panel border border-edge rounded px-2 py-1.5 text-sm text-foreground"
        aria-label="Suggest a new time"
      />
      <SecondaryCta>Suggest this time</SecondaryCta>
    </div>
  );
}

function OperatorTools({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mt-6 flex flex-wrap gap-2 border-t border-edge pt-4">
      <PrimaryCta>Create event for Sat 7:00 PM</PrimaryCta>
      <GhostCta>Cancel poll (confirm twice)</GhostCta>
    </div>
  );
}

export function StandalonePollWireframe({ persona, phaseState }: Props): JSX.Element {
  return (
    <>
      <LineupHeader
        persona={persona}
        phaseState={phaseState}
        phaseLabel="Scheduling poll"
        phaseIndex={3}
        totalPhases={4}
      />
      <MatchContextCard />
      <QuorumBanner phaseState={phaseState} />
      <ReadOnlyReason phaseState={phaseState} />
      <ParticipationRollup persona={persona} />
      <CompletedActions phaseState={phaseState} />
      <SlotList persona={persona} />
      <SuggestSection persona={persona} />
      <OperatorTools persona={persona} />
    </>
  );
}
