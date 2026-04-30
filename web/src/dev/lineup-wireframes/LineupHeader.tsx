/**
 * Compact metadata strip rendered above the page body.
 * The hero banner now carries intent/urgency — this is just the title +
 * phase progress + countdown for orientation.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { LINEUP } from './fixtures';
import { PhaseStep, PhaseDeadlineBadge } from './ui-bits';
import type { PhaseState } from './types';

interface HeaderProps {
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

function HeaderRow({ phaseLabel, phaseIndex, totalPhases, phaseState }: HeaderProps): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold text-foreground">{LINEUP.title}</h3>
      <PhaseStep index={phaseIndex} total={totalPhases} label={phaseLabel} />
      <PhaseDeadlineBadge phaseState={phaseState} />
      {LINEUP.visibility === 'private' && (
        <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider rounded bg-amber-600/20 text-amber-400 border border-amber-500/40">
          Private
        </span>
      )}
    </div>
  );
}

export function LineupHeader(props: HeaderProps): JSX.Element {
  return (
    <div className="mb-3 pb-2 border-b border-edge/50">
      <HeaderRow {...props} />
      <div className="mt-1 flex items-center justify-between flex-wrap gap-2 text-[11px] text-muted">
        <span>{LINEUP.totalVoters}/{LINEUP.totalMembers} participated</span>
        <PhaseBreadcrumb activeIndex={props.phaseIndex - 1} />
      </div>
    </div>
  );
}
