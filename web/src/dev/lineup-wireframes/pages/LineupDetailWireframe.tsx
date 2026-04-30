/**
 * Wireframe: lineup detail shell (cross-phase wrapper).
 * Hero leads; body is a compact phase summary.
 * Aborted state collapses to a snapshot.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { LINEUP } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function PhaseSummaryCard(): JSX.Element {
  return (
    <section className="bg-panel/30 border border-edge rounded-lg p-4">
      <p className="text-sm text-secondary">
        {LINEUP.title} is in <span className="text-emerald-300 font-medium">Voting</span>.
        {' '}
        {LINEUP.totalVoters}/{LINEUP.totalMembers} members have cast votes; up to {LINEUP.maxNominations} nominated games, {LINEUP.maxVotesPerPlayer} votes per member.
      </p>
    </section>
  );
}

function AbortedSnapshot(): JSX.Element {
  return (
    <section className="bg-panel/20 border border-edge/50 border-dashed rounded-lg p-4 opacity-80">
      <p className="text-sm text-muted">
        Final state preserved below for reference. The breadcrumb above shows where the lineup stopped.
      </p>
    </section>
  );
}

export function LineupDetailWireframe({ persona, phaseState }: Props): JSX.Element {
  const hero = getHeroCopy('lineup-detail', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <LineupHeader phaseState={phaseState} phaseLabel="Voting" phaseIndex={2} totalPhases={4} />
      {phaseState === 'aborted' ? <AbortedSnapshot /> : <PhaseSummaryCard />}
      <p className="text-[11px] text-dim mt-4">
        <strong>Wireframe note:</strong> the detail shell pulls phase-specific content. Switch the page sidebar to Building / Voting / Decided / Scheduling to see how the body changes per phase.
      </p>
    </>
  );
}
