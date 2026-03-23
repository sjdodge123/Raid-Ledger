/**
 * Nomination grid for the Community Lineup detail page (ROK-935).
 * Renders entries sorted by ownership in a responsive 2-column grid.
 */
import { useMemo, useCallback } from 'react';
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { useRemoveNomination } from '../../hooks/use-lineups';
import { NominationCard } from './NominationCard';

interface NominationGridProps {
    entries: LineupEntryResponseDto[];
    lineupId: number;
}

/** Sort entries by ownerCount descending. */
function sortByOwnership(entries: LineupEntryResponseDto[]): LineupEntryResponseDto[] {
    return [...entries].sort((a, b) => b.ownerCount - a.ownerCount);
}

/** Nomination grid with heading, sorted cards. */
export function NominationGrid({ entries, lineupId }: NominationGridProps): JSX.Element {
    const sorted = useMemo(() => sortByOwnership(entries), [entries]);
    const removeMutation = useRemoveNomination();
    const handleRemove = useCallback(
        (gameId: number) => removeMutation.mutate({ lineupId, gameId }),
        [lineupId, removeMutation],
    );

    return (
        <section>
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Nominated Games</h2>
                <span className="text-xs text-muted">Sorted by ownership</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sorted.map((entry) => (
                    <NominationCard key={entry.id} entry={entry} onRemove={handleRemove} />
                ))}
            </div>
        </section>
    );
}
