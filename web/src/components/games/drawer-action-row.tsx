import { Link } from 'react-router-dom';
import type { GameDetailDto } from '@raid-ledger/contract';

export interface DrawerAction {
    label: string;
    onClick: () => void;
    busy?: boolean;
}

interface DrawerActionRowProps {
    game: GameDetailDto;
    action?: DrawerAction;
}

export function DrawerActionRow({ game, action }: DrawerActionRowProps) {
    if (action) {
        return (
            <div className="mt-6">
                <button
                    type="button"
                    data-testid="game-research-drawer-cta"
                    onClick={action.onClick}
                    disabled={!!action.busy}
                    className="w-full px-4 py-2.5 rounded-md bg-emerald-500/15 text-emerald-300 font-medium border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                    {action.label}
                </button>
            </div>
        );
    }
    // game-detail-page.tsx parses :id as a number — slugs never resolve there.
    const href = `/games/${game.id}`;
    return (
        <div className="mt-6">
            <Link
                to={href}
                data-testid="game-research-drawer-cta-fallback"
                className="block w-full text-center px-4 py-2.5 rounded-md bg-panel text-foreground border border-edge/50 hover:bg-overlay/30 transition-colors"
            >
                View full game page →
            </Link>
        </div>
    );
}
