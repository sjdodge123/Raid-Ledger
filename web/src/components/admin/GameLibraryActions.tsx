interface GameActionButtonsProps {
    game: {
        id: number;
        name: string;
        banned: boolean;
        hidden: boolean;
    };
    onBan: (gameId: number, gameName: string) => void;
    onUnban: (gameId: number) => void;
    onHide: (gameId: number) => void;
    onUnhide: (gameId: number) => void;
    isBanning: boolean;
    isUnbanning: boolean;
    isHiding: boolean;
    isUnhiding: boolean;
    size?: 'sm' | 'md';
}

export function GameActionButtons({
    game, onBan, onUnban, onHide, onUnhide, isBanning, isUnbanning, isHiding, isUnhiding, size = 'md',
}: GameActionButtonsProps) {
    const btnClass = size === 'sm'
        ? 'w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-md'
        : 'w-11 h-11 flex items-center justify-center rounded-lg';

    return (
        <div className="flex items-center gap-1">
            {game.banned ? (
                <button onClick={() => onUnban(game.id)} disabled={isUnbanning}
                    className={`${btnClass} text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors`}
                    title="Unban game" aria-label="Unban game">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            ) : game.hidden ? (
                <button onClick={() => onUnhide(game.id)} disabled={isUnhiding}
                    className={`${btnClass} text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 transition-colors`}
                    title="Unhide game" aria-label="Unhide game">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                </button>
            ) : (
                <button onClick={() => onHide(game.id)} disabled={isHiding}
                    className={`${btnClass} text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 disabled:opacity-50 transition-colors`}
                    title="Hide game from users" aria-label="Hide game from users">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                </button>
            )}
            {!game.banned && (
                <button onClick={() => onBan(game.id, game.name)} disabled={isBanning}
                    className={`${btnClass} text-red-400 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors`}
                    title="Remove game" aria-label="Remove game">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            )}
        </div>
    );
}
