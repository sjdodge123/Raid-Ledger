/**
 * Pelican servers list (ROK-1094): an editable table at ≥1024px in the §4.21
 * box idiom, one stacked card per server below it (§4.18, `DESKTOP_MQ`).
 */
import { useMemo } from 'react';
import type { IgdbGameDto, PelicanServerRowDto } from '@raid-ledger/contract';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useGameRegistry } from '../../../hooks/use-game-registry';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { PelicanServerCard, PelicanServerRow, type ServerUpdateHandler } from './pelican-server-row';

const HEADERS = ['Server', 'Status', 'Game', 'Show on calendar', 'Last synced'] as const;

interface TableProps {
    rows: PelicanServerRowDto[];
    onUpdate: ServerUpdateHandler;
}

/** The first registry games, offered before the admin types (same as the player filter). */
function useGameSuggestions(): IgdbGameDto[] {
    const { games } = useGameRegistry();
    return useMemo(() => games.slice(0, 10).map((g) => ({
        id: g.id, igdbId: null, name: g.name, slug: '', coverUrl: g.coverUrl ?? null,
    } satisfies IgdbGameDto)), [games]);
}

export function PelicanServersTable({ rows, onUpdate }: TableProps) {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const suggestions = useGameSuggestions();
    const shared = { suggestions, onUpdate };
    if (!isDesktop) {
        return (
            <ul className="space-y-3" aria-label="Pelican servers" data-testid="pelican-servers-cards">
                {rows.map((row) => <li key={row.id}><PelicanServerCard row={row} {...shared} /></li>)}
            </ul>
        );
    }
    return (
        <div className="max-w-full overflow-x-auto border border-edge rounded-xl" data-testid="pelican-servers-table">
            <table className="w-full text-sm">
                <thead className="border-b border-edge bg-surface/50">
                    <tr>
                        {HEADERS.map((h) => (
                            <th key={h} scope="col" className="px-2 py-2 text-left align-bottom text-xs font-medium text-muted">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                    {rows.map((row) => <PelicanServerRow key={row.id} row={row} {...shared} />)}
                </tbody>
            </table>
        </div>
    );
}
