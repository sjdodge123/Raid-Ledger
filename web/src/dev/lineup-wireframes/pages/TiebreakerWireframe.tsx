/**
 * Wireframe: Tiebreaker (bracket + veto modes).
 * Hero leads. Body is the bracket/veto interface — the action surface.
 * Operator force-resolve lives as a ghost tail.
 * DEV-ONLY.
 */
import { useState, type JSX } from 'react';
import { TIEBREAKER_BRACKET, GAMES } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { ConfirmationPill, CoverThumbnail, GhostCta } from '../ui-bits';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function ModeSwitcher({ mode, setMode }: { mode: 'bracket' | 'veto'; setMode: (m: 'bracket' | 'veto') => void }): JSX.Element {
  return (
    <div className="inline-flex rounded-lg border border-edge overflow-hidden mb-3" data-testid="tiebreaker-mode-switcher">
      {(['bracket', 'veto'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className={`px-3 py-1.5 text-sm font-medium ${
            mode === m ? 'bg-emerald-600 text-white' : 'bg-panel text-secondary hover:bg-overlay'
          }`}
        >
          {m === 'bracket' ? 'Bracket' : 'Eliminate'}
        </button>
      ))}
    </div>
  );
}

function BracketMatchup({ a, b, choice }: { a: string; b: string; choice: 'a' | 'b' | null }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 bg-panel/40 border border-edge rounded-lg p-3 mb-2">
      {([a, b] as const).map((n, i) => {
        const key = i === 0 ? 'a' : 'b';
        const selected = choice === key;
        return (
          <button
            key={n}
            type="button"
            className={`px-3 py-2 rounded text-sm font-medium border transition-colors ${
              selected
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'border-edge text-secondary hover:bg-overlay'
            }`}
          >
            {selected && <span className="mr-1">✓</span>}
            {n}
          </button>
        );
      })}
    </div>
  );
}

function BracketProgress({ done, total }: { done: number; total: number }): JSX.Element {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
      <span className="uppercase tracking-wider text-muted">Bracket progress</span>
      <span className="text-foreground tabular-nums">
        Voted in <span className="font-semibold text-emerald-300">{done}</span> of {total} matchups
      </span>
    </div>
  );
}

function BracketView(): JSX.Element {
  const matchups = TIEBREAKER_BRACKET;
  const done = matchups.filter((m) => m.myVote != null).length;
  return (
    <section>
      <BracketProgress done={done} total={matchups.length} />
      {matchups.map((m) => <BracketMatchup key={m.id} a={m.a} b={m.b} choice={m.myVote} />)}
    </section>
  );
}

function VetoTile({ g, isVetoed }: { g: typeof GAMES[number]; isVetoed: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={`bg-panel/40 border rounded-lg p-2 transition-colors ${
        isVetoed ? 'border-red-500 ring-2 ring-red-500/40' : 'border-edge hover:border-edge-strong'
      }`}
    >
      <CoverThumbnail name={g.name} color={g.coverColor} size="lg" />
      <p className="text-xs font-medium text-foreground truncate mt-1">{g.name}</p>
      {isVetoed && <p className="text-xs text-red-400 mt-1">✓ Eliminated</p>}
    </button>
  );
}

function VetoView({ persona }: { persona: Persona }): JSX.Element {
  const games = GAMES.slice(0, 4);
  const vetoed = persona === 'invitee-acted' ? games[2].id : null;
  return (
    <section>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {games.map((g) => <VetoTile key={g.id} g={g} isVetoed={vetoed === g.id} />)}
      </div>
      {vetoed && <div className="mt-3"><ConfirmationPill>You eliminated a game</ConfirmationPill></div>}
    </section>
  );
}

function OperatorTail({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <GhostCta>Pick winner manually</GhostCta>
      <p className="text-[11px] text-dim w-full mt-1">Use these only if the tiebreaker stalls past deadline with no votes.</p>
    </div>
  );
}

function AbortedSnapshot(): JSX.Element {
  return (
    <p className="text-sm text-muted opacity-80">
      Final tiebreaker state preserved before the lineup was cancelled. The decision was reverted.
    </p>
  );
}

export function TiebreakerWireframe({ persona, phaseState }: Props): JSX.Element {
  const [mode, setMode] = useState<'bracket' | 'veto'>('bracket');
  const hero = getHeroCopy('tiebreaker', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <LineupHeader phaseState={phaseState} phaseLabel="Tiebreaker" phaseIndex={2} totalPhases={4} />
      {phaseState === 'aborted' ? (
        <AbortedSnapshot />
      ) : (
        <>
          <ModeSwitcher mode={mode} setMode={setMode} />
          {mode === 'bracket' ? <BracketView /> : <VetoView persona={persona} />}
          <OperatorTail persona={persona} />
        </>
      )}
    </>
  );
}
