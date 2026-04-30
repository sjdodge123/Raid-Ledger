/**
 * Wireframe: Building / Nominating phase.
 * Hero leads. Body focuses on the nomination grid; "Add yours" affordance
 * is now de-emphasized since the hero CTA carries the action.
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { GAMES } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { ConfirmationPill, CoverThumbnail } from '../ui-bits';
import { HeroNextStep } from '../HeroNextStep';
import { getHeroCopy } from '../hero-copy';
import type { Persona, PhaseState } from '../types';

interface Props { persona: Persona; phaseState: PhaseState }

const MY_NOMINATION = GAMES[0];

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

function NominationGrid({ persona }: { persona: Persona }): JSX.Element {
  const items = GAMES.slice(0, 6);
  const myId = persona === 'invitee-acted' || persona === 'organizer' ? MY_NOMINATION.id : null;
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Nominated games · {items.length}</h3>
        <span className="text-xs text-muted">Sorted by ownership</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((g) => (
          <NominationCard key={g.id} g={g} mine={g.id === myId} />
        ))}
      </div>
    </section>
  );
}

function AbortedSnapshot(): JSX.Element {
  return (
    <div className="opacity-70">
      <p className="text-sm text-muted mb-3">Final list of nominations before the lineup was cancelled.</p>
      <NominationGrid persona="uninvited" />
    </div>
  );
}

export function BuildingWireframe({ persona, phaseState }: Props): JSX.Element {
  const hero = getHeroCopy('building', persona, phaseState);
  return (
    <>
      <HeroNextStep {...hero} />
      <LineupHeader phaseState={phaseState} phaseLabel="Nominating" phaseIndex={1} totalPhases={4} />
      {phaseState === 'aborted' ? <AbortedSnapshot /> : <NominationGrid persona={persona} />}
    </>
  );
}
