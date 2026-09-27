import { Button } from '../ui/button';

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

type ButtonSize = 'sm' | 'md';

/** Ghost icon Button tinted by a semantic token (no warning/success variant exists). */
const TONE = {
    success: 'text-success hover:text-success',
    warning: 'text-warning hover:text-warning',
} as const;

const ICON_PATHS = {
    unban: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    hide: 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21',
    remove: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
} as const;

function Icon({ paths }: { paths: readonly string[] }) {
    return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            {paths.map((d) => <path key={d} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />)}
        </svg>
    );
}

const UNHIDE_PATHS = [
    'M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    'M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
];

function ToneButton({ label, tone, size, onClick, disabled, paths }: {
    label: string; tone: keyof typeof TONE; size: ButtonSize; onClick: () => void; disabled: boolean; paths: readonly string[];
}) {
    return (
        <Button iconOnly variant="ghost" size={size} className={TONE[tone]} onClick={onClick} disabled={disabled}
            title={label} aria-label={label}>
            <Icon paths={paths} />
        </Button>
    );
}

function VisibilityButton({ game, size, onUnban, onUnhide, onHide, isUnbanning, isUnhiding, isHiding }: {
    game: GameActionButtonsProps['game']; size: ButtonSize;
    onUnban: (id: number) => void; onUnhide: (id: number) => void; onHide: (id: number) => void;
    isUnbanning: boolean; isUnhiding: boolean; isHiding: boolean;
}) {
    if (game.banned) {
        return <ToneButton label="Unban game" tone="success" size={size} onClick={() => onUnban(game.id)}
            disabled={isUnbanning} paths={[ICON_PATHS.unban]} />;
    }
    if (game.hidden) {
        return <ToneButton label="Unhide game" tone="success" size={size} onClick={() => onUnhide(game.id)}
            disabled={isUnhiding} paths={UNHIDE_PATHS} />;
    }
    return <ToneButton label="Hide game from users" tone="warning" size={size} onClick={() => onHide(game.id)}
        disabled={isHiding} paths={[ICON_PATHS.hide]} />;
}

export function GameActionButtons({
    game, onBan, onUnban, onHide, onUnhide, isBanning, isUnbanning, isHiding, isUnhiding, size = 'md',
}: GameActionButtonsProps) {
    return (
        <div className="flex items-center gap-1">
            <VisibilityButton game={game} size={size} onUnban={onUnban} onUnhide={onUnhide} onHide={onHide}
                isUnbanning={isUnbanning} isUnhiding={isUnhiding} isHiding={isHiding} />
            {!game.banned && (
                <Button iconOnly variant="destructive-soft" size={size} onClick={() => onBan(game.id, game.name)}
                    disabled={isBanning} title="Remove game" aria-label="Remove game">
                    <Icon paths={[ICON_PATHS.remove]} />
                </Button>
            )}
        </div>
    );
}
