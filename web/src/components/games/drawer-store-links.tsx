import type { GameDetailDto } from '@raid-ledger/contract';

interface DrawerStoreLinksProps {
    game: GameDetailDto;
}

function buildSteamUrl(game: GameDetailDto): string | null {
    if (game.steamAppId) {
        return `https://store.steampowered.com/app/${game.steamAppId}`;
    }
    return null;
}

export function DrawerStoreLinks({ game }: DrawerStoreLinksProps) {
    const steamUrl = buildSteamUrl(game);
    const dealUrl = game.itadCurrentUrl ?? null;
    const hasAny = steamUrl || dealUrl;
    if (!hasAny) {
        return (
            <div
                data-testid="game-research-drawer-store-links"
                className="mt-4 text-sm text-muted"
            >
                No store links available
            </div>
        );
    }
    return (
        <div
            data-testid="game-research-drawer-store-links"
            className="mt-4 flex flex-wrap items-center gap-2"
        >
            {steamUrl && (
                <a
                    href={steamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm rounded-md bg-panel text-foreground hover:bg-overlay/40 border border-edge/50"
                >
                    Steam
                </a>
            )}
            {dealUrl && dealUrl !== steamUrl && (
                <a
                    href={dealUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 text-sm rounded-md bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/30"
                >
                    {game.itadCurrentShop ?? 'Best deal'}
                </a>
            )}
        </div>
    );
}
