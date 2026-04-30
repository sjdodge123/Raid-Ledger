/**
 * Wireframe: standalone scheduling poll page (share-link variant).
 * Hero leads. Body is the slot grid only — no lineup chrome.
 * The full in-lineup scheduling experience lives at /scheduling.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { SLOTS, LINEUP } from '../fixtures';
import { ConfirmationPill, VoteBar } from '../ui-bits';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

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
    <section className="bg-surface border border-edge rounded-xl overflow-hidden">
      <div className="bg-panel/40 px-4 py-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">Suggested times</span>
        <span className="text-xs text-muted">5 of {LINEUP.totalMembers} voted</span>
      </div>
      <ul>
        {SLOTS.map((s) => <SlotRow key={s.id} s={s} persona={persona} />)}
      </ul>
    </section>
  );
}

function AbortedSnapshot(): JSX.Element {
  return (
    <p className="text-sm text-muted opacity-80">
      The lineup containing this poll was cancelled. Voting is closed; the snapshot is preserved above the fold.
    </p>
  );
}

export function StandalonePollWireframe({ persona, phaseState }: Props): JSX.Element {
  const hero = getHeroCopy('standalone-poll', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <p className="text-[11px] text-dim mb-3">
        Share-link variant — the lean poll without lineup chrome. The full in-lineup version lives at /dev/wireframes/lineup/scheduling/...
      </p>
      {phaseState === 'aborted' ? (
        <AbortedSnapshot />
      ) : (
        <>
          <ParticipationRollup persona={persona} />
          <SlotList persona={persona} />
        </>
      )}
    </>
  );
}
