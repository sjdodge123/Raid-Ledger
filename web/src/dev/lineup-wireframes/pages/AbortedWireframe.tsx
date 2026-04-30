/**
 * Wireframe: aborted-state lineup detail page.
 * Demonstrates F-5 — surface the aborted state on the detail page (closes ROK-1062 frontend gap).
 * DEV-ONLY.
 */
import type { JSX } from 'react';
import { GAMES } from '../fixtures';
import { LineupHeader } from '../LineupHeader';
import { CoverThumbnail, SecondaryCta, StatusBanner } from '../ui-bits';
import type { Persona } from '../types';

interface Props { persona: Persona }

function ReadOnlySnapshot(): JSX.Element {
  const top3 = GAMES.slice(0, 3);
  return (
    <section>
      <h3 className="text-sm font-semibold text-foreground mb-3">Final snapshot</h3>
      <div className="grid grid-cols-3 gap-3">
        {top3.map((g, i) => (
          <div key={g.id} className="bg-panel/30 border border-edge border-dashed rounded-lg p-3 text-center opacity-70">
            <CoverThumbnail name={g.name} color={g.coverColor} size="lg" />
            <p className="text-xs uppercase tracking-wider text-dim mt-2">{['1st', '2nd', '3rd'][i]} (locked)</p>
            <p className="text-sm text-foreground truncate">{g.name}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AbortedActions({ persona }: { persona: Persona }): JSX.Element {
  if (persona === 'organizer' || persona === 'admin') {
    return (
      <div className="flex flex-wrap gap-2 mb-4">
        <SecondaryCta>Restart lineup</SecondaryCta>
        <SecondaryCta>View audit log</SecondaryCta>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <SecondaryCta>Browse other lineups</SecondaryCta>
    </div>
  );
}

export function AbortedWireframe({ persona }: Props): JSX.Element {
  return (
    <>
      <LineupHeader
        persona={persona}
        phaseState="aborted"
        phaseLabel="Cancelled"
        phaseIndex={2}
        totalPhases={4}
      />
      <StatusBanner tone="info">
        Cancelled by <strong>admin@raidledger</strong> on Apr 28, 2026 at 4:42pm. Reason: <em>"Date conflict — rescheduling for next weekend."</em>
      </StatusBanner>
      <AbortedActions persona={persona} />
      <ReadOnlySnapshot />
      <p className="text-xs text-dim mt-6">
        <strong>Wireframe note:</strong> ROK-1062 added the kill-switch backend; this is the proposed frontend treatment (Audit F-5).
      </p>
    </>
  );
}
