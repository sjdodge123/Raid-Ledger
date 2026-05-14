/**
 * AbortedReadOnlySnapshot (ROK-1207) — body content for an aborted lineup.
 *
 * Short-circuits the phase body on the detail page. Wireframe target: a
 * compact "Final state preserved below" note plus the entries the lineup
 * had at abort time. We reuse `NominationGrid` because it has no built-in
 * action affordances (read-only by construction); voting tallies and the
 * inline Nominate/advance affordances are suppressed upstream via the
 * `isAborted` guard on `LineupDetailLoaded`.
 */
import type { JSX } from 'react';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { NominationGrid } from './NominationGrid';
import { LineupEmptyState } from './LineupEmptyState';

interface Props {
    lineup: LineupDetailResponseDto;
}

export function AbortedReadOnlySnapshot({ lineup }: Props): JSX.Element {
    return (
        <section
            data-testid="lineup-aborted-snapshot"
            className="bg-panel/20 border border-edge/50 border-dashed rounded-lg p-4"
        >
            <p className="text-sm text-muted mb-3">
                Final state preserved below for reference. Nominations and
                votes are closed.
            </p>
            {lineup.entries.length > 0 ? (
                <NominationGrid entries={lineup.entries} lineupId={lineup.id} />
            ) : (
                <LineupEmptyState />
            )}
        </section>
    );
}
