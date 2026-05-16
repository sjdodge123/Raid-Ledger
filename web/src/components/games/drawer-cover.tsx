import type { GameDetailDto } from '@raid-ledger/contract';

interface DrawerCoverProps {
    game: GameDetailDto;
}

export function DrawerCover({ game }: DrawerCoverProps) {
    const url = game.coverUrl ?? game.itadBoxartUrl ?? null;
    if (!url) {
        return (
            <div
                data-testid="game-research-drawer-cover"
                className="w-full aspect-[3/4] bg-panel rounded-lg flex items-center justify-center text-muted"
            >
                <span>No cover</span>
            </div>
        );
    }
    return (
        <div data-testid="game-research-drawer-cover" className="w-full">
            <img
                src={url}
                alt={`${game.name} cover`}
                className="w-full aspect-[3/4] object-cover rounded-lg"
            />
        </div>
    );
}
