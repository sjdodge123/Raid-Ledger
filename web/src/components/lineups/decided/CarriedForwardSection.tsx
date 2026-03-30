/**
 * Carried Forward section showing game name chips (ROK-989).
 * Displays games that were carried over from a previous lineup.
 */
import type { JSX } from 'react';
import type { CarriedForwardEntryDto } from '@raid-ledger/contract';

interface CarriedForwardSectionProps {
  entries: CarriedForwardEntryDto[];
}

/** Single game chip with name. */
function GameChip({ entry }: { entry: CarriedForwardEntryDto }): JSX.Element {
  return (
    <span
      data-testid="carried-forward-chip"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-secondary bg-zinc-800 border border-edge rounded-full"
    >
      {entry.gameCoverUrl && (
        <img
          src={entry.gameCoverUrl}
          alt=""
          className="w-4 h-4 rounded-sm object-cover"
        />
      )}
      {entry.gameName}
    </span>
  );
}

/** Section listing carried-forward games as chips. Hidden if empty. */
export function CarriedForwardSection({
  entries,
}: CarriedForwardSectionProps): JSX.Element | null {
  if (entries.length === 0) return null;

  return (
    <section data-testid="carried-forward-section" className="mt-6">
      <h3 className="text-xs font-semibold text-dim uppercase tracking-wider mb-2">
        Carried Forward
      </h3>
      <div className="flex flex-wrap gap-2">
        {entries.map((e) => (
          <GameChip key={e.gameId} entry={e} />
        ))}
      </div>
    </section>
  );
}
