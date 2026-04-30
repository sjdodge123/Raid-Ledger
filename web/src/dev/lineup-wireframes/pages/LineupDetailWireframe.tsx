/**
 * Wireframe: lineup detail shell (cross-phase wrapper).
 * Demonstrates F-1, F-3, F-5, F-7 — phase-step + auto-advance + aborted + privacy banners.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { LINEUP } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { PrimaryCta, SecondaryCta, GhostCta, StatusBanner } from '../ui-bits';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

function nextStepCopy(persona: Persona): string {
  switch (persona) {
    case 'invitee-not-acted':
      return 'Open Voting to pick up to 3 games.';
    case 'invitee-acted':
      return "You've voted. Sit tight — the deadline closes in 7h.";
    case 'organizer':
    case 'admin':
      return 'Quorum reached (7/12). Advance to Decided when ready.';
    case 'uninvited':
      return 'Read-only — request an invite from the organizer.';
  }
}

function NextStepBlock({ persona, phaseState }: Props): JSX.Element | null {
  if (phaseState === 'aborted') return null;
  return (
    <StatusBanner tone={persona === 'invitee-acted' ? 'success' : 'info'}>
      <strong>Your next step:</strong> {nextStepCopy(persona)}
    </StatusBanner>
  );
}

function ChromeActions({ persona }: { persona: Persona }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {persona === 'invitee-not-acted' && <PrimaryCta>Open Voting</PrimaryCta>}
      {persona === 'invitee-acted' && <SecondaryCta>Change my votes</SecondaryCta>}
      {(persona === 'organizer' || persona === 'admin') && (
        <>
          <PrimaryCta>Advance to Decided</PrimaryCta>
          <SecondaryCta>Edit lineup</SecondaryCta>
          <GhostCta>Cancel lineup</GhostCta>
        </>
      )}
      {persona === 'uninvited' && <SecondaryCta>Request invite</SecondaryCta>}
    </div>
  );
}

function LineupSummary(): JSX.Element {
  return (
    <section className="bg-panel/30 border border-edge rounded-lg p-4 mb-4">
      <h3 className="text-sm font-semibold text-foreground mb-2">About this lineup</h3>
      <p className="text-sm text-secondary">
        {LINEUP.title} — Saturday Night Crew is voting on {LINEUP.nominatedCount} nominated games.
        Up to {LINEUP.maxNominations} games allowed; each member can cast {LINEUP.maxVotesPerPlayer} votes.
      </p>
    </section>
  );
}

export function LineupDetailWireframe({ persona, phaseState }: Props): JSX.Element {
  return (
    <>
      <LineupHeader
        persona={persona}
        phaseState={phaseState}
        phaseLabel="Voting"
        phaseIndex={2}
        totalPhases={4}
      />
      <NextStepBlock persona={persona} phaseState={phaseState} />
      <ChromeActions persona={persona} />
      <LineupSummary />
      <p className="text-xs text-dim">
        <strong>Wireframe note:</strong> the detail shell pulls phase-specific content. Switch the page sidebar to Building / Voting / Decided to see how the body changes per phase.
      </p>
    </>
  );
}
