/**
 * Desktop-only existing-nominations grid for the Nominating composite
 * (ROK-1297). Mobile uses MyNominationsDrawer instead — the composite
 * gates this section with `hidden md:block`. Extracted from
 * NominatingComposite so the parent stays under the 300-line cap.
 */
import type { JSX } from 'react';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { useRemoveNomination } from '../../../hooks/use-lineups';
import { NominationCard } from '../NominationCard';

export function ExistingNominations({
  entries,
  lineupId,
}: {
  entries: LineupEntryResponseDto[];
  lineupId: number;
}): JSX.Element {
  const removeMutation = useRemoveNomination();
  const handleRemove = (gameId: number): void => {
    removeMutation.mutate({ lineupId, gameId });
  };
  if (entries.length === 0) {
    return (
      <div className="text-center py-8" data-testid="nominations-empty">
        <p className="text-muted text-sm">
          No nominations match this filter yet.
        </p>
      </div>
    );
  }
  return (
    <section data-testid="nominations-list">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          Nominated Games
        </h2>
        <span className="text-xs text-muted">{entries.length} shown</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {entries.map((entry) => (
          <NominationCard
            key={entry.id}
            entry={entry}
            onRemove={handleRemove}
          />
        ))}
      </div>
    </section>
  );
}
