import { useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { GameResearchDrawer } from './GameResearchDrawer';
import type { DrawerAction } from './drawer-action-row';

type Variant = 'row' | 'inline' | 'thumb';

interface GameRefProps {
    variant?: Variant;
    /** Known game id (preferred). When omitted, free-text name is looked up. */
    gameId?: number;
    /** Display name; also the lookup key when gameId is absent. */
    name: string;
    /** Optional sub line for the `row` variant. */
    sub?: ReactNode;
    /** Optional cover URL for `row`/`thumb` thumbnail. */
    coverUrl?: string | null;
    /** Optional inline CTA. Clicking it does NOT open the drawer. */
    action?: DrawerAction;
}

function InfoAffordance() {
    return (
        <span
            data-testid="game-ref-info-affordance"
            aria-hidden="true"
            className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-edge/40 text-muted text-[10px] font-semibold opacity-0 group-hover/gameref:opacity-100 transition-opacity"
            title="Open game details"
        >
            i
        </span>
    );
}

function Thumb({ coverUrl, name }: { coverUrl: string | null | undefined; name: string }) {
    if (!coverUrl) {
        return (
            <div className="w-10 h-14 flex-shrink-0 rounded-md bg-panel border border-edge/40 flex items-center justify-center text-[10px] text-muted">
                {name.slice(0, 2).toUpperCase()}
            </div>
        );
    }
    return (
        <img
            src={coverUrl}
            alt=""
            className="w-10 h-14 flex-shrink-0 rounded-md object-cover border border-edge/40"
        />
    );
}

function RowVariant({
    name,
    sub,
    coverUrl,
    action,
    onOpen,
}: {
    name: string;
    sub: ReactNode | undefined;
    coverUrl: string | null | undefined;
    action: DrawerAction | undefined;
    onOpen: () => void;
}) {
    const handleClick = (e: React.MouseEvent) => {
        if (e.defaultPrevented) return;
        onOpen();
    };
    return (
        <div
            data-testid="game-ref-row"
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
            className="group/gameref flex items-center gap-3 px-2 py-2 rounded-md hover:bg-overlay/20 cursor-pointer"
        >
            <Thumb coverUrl={coverUrl} name={name} />
            <div className="flex-1 min-w-0">
                <div className="flex items-center text-sm font-medium text-foreground truncate">
                    <span className="truncate">{name}</span>
                    <InfoAffordance />
                </div>
                {sub != null && <div className="text-xs text-muted truncate">{sub}</div>}
            </div>
            {action && <RowAction action={action} />}
        </div>
    );
}

function RowAction({ action }: { action: DrawerAction }) {
    const handle = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        action.onClick();
    };
    return (
        <button
            type="button"
            data-testid="game-ref-row-action"
            onClick={handle}
            disabled={!!action.busy}
            className="px-3 py-1 text-xs rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 disabled:opacity-60"
        >
            {action.label}
        </button>
    );
}

function InlineVariant({
    name,
    onOpen,
}: {
    name: string;
    onOpen: () => void;
}) {
    return (
        <span
            data-testid="game-ref-row"
            className="group/gameref inline-flex items-center cursor-pointer text-foreground hover:text-emerald-300"
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen();
                }
            }}
        >
            <span>{name}</span>
            <InfoAffordance />
        </span>
    );
}

function ThumbVariant({
    name,
    coverUrl,
    onOpen,
}: {
    name: string;
    coverUrl: string | null | undefined;
    onOpen: () => void;
}) {
    return (
        <button
            type="button"
            data-testid="game-ref-row"
            onClick={onOpen}
            className="group/gameref relative block rounded-md overflow-hidden border border-edge/40 hover:border-emerald-500/50"
            aria-label={`Open ${name} research`}
        >
            <Thumb coverUrl={coverUrl} name={name} />
            <InfoAffordance />
        </button>
    );
}

export function GameRef({
    variant = 'row',
    gameId,
    name,
    sub,
    coverUrl,
    action,
}: GameRefProps) {
    const [isOpen, setIsOpen] = useState(false);
    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);
    return (
        <>
            {variant === 'row' && (
                <RowVariant
                    name={name}
                    sub={sub}
                    coverUrl={coverUrl}
                    action={action}
                    onOpen={open}
                />
            )}
            {variant === 'inline' && <InlineVariant name={name} onOpen={open} />}
            {variant === 'thumb' && (
                <ThumbVariant name={name} coverUrl={coverUrl} onOpen={open} />
            )}
            <GameResearchDrawer
                isOpen={isOpen}
                onClose={close}
                gameId={gameId}
                name={name}
            />
        </>
    );
}
