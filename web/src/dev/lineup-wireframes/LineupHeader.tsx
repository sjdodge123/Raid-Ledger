/**
 * Lineup detail header used inside most page wireframes.
 * Demonstrates F-1 (plain-language phase step) + F-7 (privacy banner)
 * + F-5 (aborted state).
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { LINEUP } from './fixtures';
import { PhaseStep, PhaseDeadlineBadge, StatusBanner } from './ui-bits';
import type { Persona, PhaseState } from './types';

interface HeaderProps {
  persona: Persona;
  phaseState: PhaseState;
  phaseLabel: string;
  phaseIndex: number;
  totalPhases: number;
}

function PhaseBreadcrumb({ activeIndex }: { activeIndex: number }): JSX.Element {
  const phases = ['Nominating', 'Voting', 'Scheduling', 'Archived'];
  return (
    <div className="flex items-center gap-1 text-xs text-dim">
      {phases.map((p, i) => (
        <span key={p} className="inline-flex items-center">
          {i > 0 && <span className="mx-1">→</span>}
          <span className={i === activeIndex ? 'text-emerald-400 font-medium' : ''}>{p}</span>
        </span>
      ))}
    </div>
  );
}

function PrivacyBanner({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'uninvited') return null;
  return (
    <StatusBanner tone="amber">
      <strong>Read-only view.</strong> You are not on the invite list — you can browse this lineup but not nominate, vote, or join matches.
      {' '}
      <button type="button" className="ml-2 underline font-medium">Request an invite →</button>
    </StatusBanner>
  );
}

function AbortedBanner({ phaseState }: { phaseState: PhaseState }): JSX.Element | null {
  if (phaseState !== 'aborted') return null;
  return (
    <StatusBanner tone="danger">
      <strong>Lineup cancelled.</strong> An admin stopped this lineup on Apr 28 — voting and nominations are closed. Contact the organizer if this is unexpected.
    </StatusBanner>
  );
}

function AutoAdvanceBanner({ phaseState }: { phaseState: PhaseState }): JSX.Element | null {
  if (phaseState !== 'deadline-missed') return null;
  return (
    <StatusBanner tone="urgent">
      <strong>Phase ended 12 minutes ago.</strong> Auto-advancing to the next phase shortly. Your last actions are saved.
    </StatusBanner>
  );
}

function HeaderRow({ phaseLabel, phaseIndex, totalPhases, phaseState }: {
  phaseLabel: string; phaseIndex: number; totalPhases: number; phaseState: PhaseState;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-lg font-bold text-foreground">{LINEUP.title}</h2>
      <PhaseStep index={phaseIndex} total={totalPhases} label={phaseLabel} />
      <PhaseDeadlineBadge phaseState={phaseState} />
      {LINEUP.visibility === 'private' && (
        <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-600/20 text-amber-400 border border-amber-500/40">
          Private
        </span>
      )}
    </div>
  );
}

export function LineupHeader({ persona, phaseState, phaseLabel, phaseIndex, totalPhases }: HeaderProps): JSX.Element {
  return (
    <div className="border-b border-edge pb-3 mb-4">
      <HeaderRow
        phaseLabel={phaseLabel}
        phaseIndex={phaseIndex}
        totalPhases={totalPhases}
        phaseState={phaseState}
      />
      <div className="mt-2 flex items-center justify-between flex-wrap gap-2 text-xs text-muted">
        <span>Started by {LINEUP.startedBy} · {LINEUP.totalVoters}/{LINEUP.totalMembers} participated</span>
        <PhaseBreadcrumb activeIndex={phaseIndex - 1} />
      </div>
      <div className="mt-3">
        <PrivacyBanner persona={persona} />
        <AbortedBanner phaseState={phaseState} />
        <AutoAdvanceBanner phaseState={phaseState} />
      </div>
    </div>
  );
}
