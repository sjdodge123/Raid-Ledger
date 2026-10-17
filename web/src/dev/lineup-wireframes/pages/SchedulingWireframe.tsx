/**
 * Wireframe: in-lineup Scheduling page (slot picker for the decided game).
 * Hero leads. Body is the slot grid — the page's primary action surface.
 * Distinct from StandalonePollWireframe (share-link variant) which strips lineup chrome.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { LINEUP, SLOTS } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { ConfirmationPill, GhostCta, VoteBar } from '../ui-bits';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function MatchContext(): JSX.Element {
  return (
    <section className="mb-3 p-3 bg-panel/30 border border-edge rounded-lg">
      <p className="text-xs uppercase tracking-wider text-muted">Scheduling</p>
      <h3 className="text-sm font-semibold text-foreground mt-0.5">Hollowforge — {LINEUP.title}</h3>
      <p className="text-xs text-secondary mt-1">5 members picking from {SLOTS.length} time slots · 8 of {LINEUP.totalMembers} have voted</p>
    </section>
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
      <div className="w-32 hidden sm:block">
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
        {s.myVote ? '✓ Picked' : 'Pick'}
      </button>
    </li>
  );
}

function SlotGrid({ persona }: { persona: Persona }): JSX.Element {
  return (
    <section className="bg-surface border border-edge rounded-xl overflow-hidden">
      <div className="bg-panel/40 px-4 py-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">Time slots</span>
        <span className="text-xs text-muted">Sorted by votes</span>
      </div>
      <ul>
        {SLOTS.map((s) => <SlotRow key={s.id} s={s} persona={persona} />)}
      </ul>
    </section>
  );
}

function ParticipationRollup({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'invitee-acted') return null;
  const myPicks = SLOTS.filter((s) => s.myVote).length;
  return <div className="mb-3"><ConfirmationPill>You picked {myPicks} time slots</ConfirmationPill></div>;
}

function SuggestRow({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona === 'uninvited') return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        type="datetime-local"
        className="bg-panel border border-edge rounded px-2 py-1.5 text-sm text-foreground"
        aria-label="Suggest a new time"
      />
      <GhostCta>Suggest this time</GhostCta>
    </div>
  );
}

function OperatorTail({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <GhostCta>Cancel scheduling (confirm twice)</GhostCta>
    </div>
  );
}

function AbortedSnapshot(): JSX.Element {
  return (
    <p className="text-sm text-muted opacity-80">
      Scheduling was cancelled along with the lineup. Final votes are preserved above the fold.
    </p>
  );
}

export function SchedulingWireframe({ persona, phaseState }: Props): JSX.Element {
  const hero = getHeroCopy('scheduling', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <LineupHeader phaseState={phaseState} phaseLabel="Scheduling" phaseIndex={3} totalPhases={4} />
      {phaseState === 'aborted' ? (
        <AbortedSnapshot />
      ) : (
        <>
          <MatchContext />
          <ParticipationRollup persona={persona} />
          <SlotGrid persona={persona} />
          <SuggestRow persona={persona} />
          <OperatorTail persona={persona} />
        </>
      )}
    </>
  );
}
