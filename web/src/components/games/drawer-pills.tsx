import type { GameDetailDto } from '@raid-ledger/contract';
import { GENRE_MAP } from '../../lib/game-utils';

interface DrawerPillsProps {
    game: GameDetailDto;
    ownershipCount: number;
}

function primaryGenreLabel(game: GameDetailDto): string | null {
    const id = game.genres?.[0];
    if (id == null) return null;
    return GENRE_MAP[id] ?? null;
}

function formatPrice(p: number): string {
    return `$${p.toFixed(2)}`;
}

export function DrawerPills({ game, ownershipCount }: DrawerPillsProps) {
    const genre = primaryGenreLabel(game);
    const cut = game.itadCurrentCut ?? null;
    const price = game.itadCurrentPrice ?? null;
    return (
        <div
            data-testid="game-research-drawer-pills"
            className="flex flex-wrap items-center gap-2 mt-3"
        >
            {genre && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                    {genre}
                </span>
            )}
            <span className="px-2 py-0.5 text-xs rounded-full bg-panel text-muted border border-edge/50">
                {ownershipCount} {ownershipCount === 1 ? 'owner' : 'owners'}
            </span>
            {cut != null && cut > 0 && price != null && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30">
                    {`-${cut}% ${formatPrice(price)}`}
                </span>
            )}
        </div>
    );
}
