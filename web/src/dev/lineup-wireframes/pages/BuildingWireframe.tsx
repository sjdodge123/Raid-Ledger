/**
 * Wireframe: Building / Nominating phase.
 * Demonstrates F-8, F-9, F-10 — single-CTA hierarchy + nomination-confirmation pill +
 * last-chance banner.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { GAMES } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import {
  PrimaryCta, SecondaryCta, GhostCta, ConfirmationPill, StatusBanner, CoverThumbnail,
} from '../ui-bits';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

const MY_NOMINATION = GAMES[0];

function LastChanceBanner({ phaseState }: { phaseState: PhaseState }): JSX.Element | null {
  if (phaseState !== 'deadline-soon') return null;
  return (
    <StatusBanner tone="urgent">
      <strong>Voting starts in 7h.</strong> Add your last nominations now — once we move to voting, the list locks.
    </StatusBanner>
  );
}

function NominateAction({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona === 'uninvited') return null;
  const hasMine = persona === 'invitee-acted' || persona === 'organizer';
  return (
    <section className="mb-4 p-4 rounded-lg bg-panel/40 border border-edge">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {hasMine ? 'Your nominations' : 'Add your nomination'}
        </h3>
        {hasMine && <ConfirmationPill>You nominated {MY_NOMINATION.name}</ConfirmationPill>}
      </div>
      <div className="flex gap-2 flex-wrap">
        <PrimaryCta>{hasMine ? 'Nominate another game' : 'Nominate a game'}</PrimaryCta>
        {hasMine && <SecondaryCta>Remove my nomination</SecondaryCta>}
      </div>
    </section>
  );
}

function OperatorActions({ persona }: { persona: Persona }): JSX.Element | null {
  if (persona !== 'organizer' && persona !== 'admin') return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <SecondaryCta>Advance to Voting (7/12 nominated)</SecondaryCta>
      <GhostCta>Edit lineup</GhostCta>
    </div>
  );
}

function NominationCard({ g, mine }: { g: typeof GAMES[number]; mine: boolean }): JSX.Element {
  return (
    <div className="bg-surface border border-edge rounded-lg p-3 flex items-start gap-3" data-testid="nomination-card">
      <CoverThumbnail name={g.name} color={g.coverColor} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
        <p className="text-xs text-muted">{g.ownerCount} players own</p>
        {mine && <ConfirmationPill>Your nomination</ConfirmationPill>}
      </div>
    </div>
  );
}

function NominationGrid(): JSX.Element {
  const items = GAMES.slice(0, 6);
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Nominated so far</h3>
        <span className="text-xs text-muted">Sorted by ownership</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((g) => (
          <NominationCard key={g.id} g={g} mine={g.id === MY_NOMINATION.id} />
        ))}
      </div>
    </section>
  );
}

export function BuildingWireframe({ persona, phaseState }: Props): JSX.Element {
  return (
    <>
      <LineupHeader
        persona={persona}
        phaseState={phaseState}
        phaseLabel="Nominating"
        phaseIndex={1}
        totalPhases={4}
      />
      <LastChanceBanner phaseState={phaseState} />
      <NominateAction persona={persona} />
      <OperatorActions persona={persona} />
      <NominationGrid />
    </>
  );
}
