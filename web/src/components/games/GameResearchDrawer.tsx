import { useEffect, useRef } from 'react';
import type { GameDetailDto } from '@raid-ledger/contract';
import { Z_INDEX } from '../../lib/z-index';
import { useFocusTrap } from '../../hooks/use-focus-trap';
import { useGameDetail } from '../../hooks/use-games-discover';
import { useWantToPlay } from '../../hooks/use-want-to-play';
import { useGameLookupByName } from '../../hooks/use-game-lookup-by-name';
import { DrawerHeader } from './drawer-header';
import { DrawerCover } from './drawer-cover';
import { DrawerPills } from './drawer-pills';
import { DrawerScreenshots } from './drawer-screenshots';
import { DrawerStoreLinks } from './drawer-store-links';
import { DrawerActionRow, type DrawerAction } from './drawer-action-row';

interface GameResearchDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    /** Resolve by gameId (preferred when known). */
    gameId?: number;
    /** Resolve by free-text name (triggers POST /games/lookup-by-name). */
    name?: string;
    /** Caller-supplied CTA. Omit to render the fallback "View full game page" link. */
    action?: DrawerAction;
}

interface ResolvedGame {
    game: GameDetailDto | undefined;
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
}

function useResolvedGame(
    isOpen: boolean,
    gameId: number | undefined,
    name: string | undefined,
): ResolvedGame {
    // Pass gameId only when isOpen — every DrawerCard mounts a hidden drawer,
    // so an unconditional useGameDetail would fire one GET /games/:id per card
    // on first render of /games (Codex review finding P1).
    const byId = useGameDetail(isOpen ? gameId : undefined);
    const lookupEnabled = isOpen && !gameId && !!name;
    const byName = useGameLookupByName(name, lookupEnabled);
    const source = gameId ? byId : byName;
    return {
        game: source?.data,
        isLoading: source?.isLoading ?? false,
        isError: source?.isError ?? false,
        refetch: source?.refetch ?? (() => {}),
    };
}

function useInitialFocus(isOpen: boolean, dialogRef: React.RefObject<HTMLDivElement>) {
    useEffect(() => {
        if (!isOpen) return;
        const node = dialogRef.current;
        if (!node) return;
        const id = requestAnimationFrame(() => {
            const closeBtn = node.querySelector<HTMLElement>('[data-testid="game-research-drawer-close"]');
            if (closeBtn) {
                closeBtn.focus();
            } else {
                node.focus();
            }
        });
        return () => cancelAnimationFrame(id);
    }, [isOpen, dialogRef]);
}

function useEscToClose(isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', handler);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);
}

function DrawerSkeleton() {
    return (
        <div data-testid="game-research-drawer-skeleton" className="p-4 space-y-3 animate-pulse">
            <div className="w-full aspect-[3/4] bg-panel rounded-lg" />
            <div className="h-4 bg-panel rounded w-3/4" />
            <div className="h-3 bg-panel rounded w-full" />
            <div className="h-3 bg-panel rounded w-5/6" />
            <div className="flex gap-2">
                <div className="h-5 bg-panel rounded-full w-16" />
                <div className="h-5 bg-panel rounded-full w-16" />
            </div>
        </div>
    );
}

function DrawerError({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
    return (
        <div className="p-6 text-center space-y-3">
            <p className="text-foreground">Couldn’t load this game</p>
            <div className="flex gap-2 justify-center">
                <button
                    type="button"
                    onClick={onRetry}
                    className="px-4 py-2 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors"
                >
                    Retry
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-md bg-panel text-foreground border border-edge/50 hover:bg-overlay/30 transition-colors"
                >
                    Close
                </button>
            </div>
        </div>
    );
}

function DrawerContent({
    game,
    action,
}: {
    game: GameDetailDto;
    action: DrawerAction | undefined;
}) {
    const { count } = useWantToPlay(game.id);
    return (
        <div className="p-4">
            <DrawerCover game={game} />
            {game.summary && (
                <p className="mt-4 text-sm text-muted leading-relaxed">{game.summary}</p>
            )}
            <DrawerPills game={game} ownershipCount={count ?? 0} />
            <DrawerScreenshots screenshots={game.screenshots ?? []} gameName={game.name} />
            <DrawerStoreLinks game={game} />
            <DrawerActionRow game={game} action={action} />
        </div>
    );
}

function DrawerBody({
    resolved,
    onClose,
    action,
}: {
    resolved: ResolvedGame;
    onClose: () => void;
    action: DrawerAction | undefined;
}) {
    if (resolved.isLoading) return <DrawerSkeleton />;
    if (resolved.isError || !resolved.game) {
        return <DrawerError onRetry={resolved.refetch} onClose={onClose} />;
    }
    return <DrawerContent game={resolved.game} action={action} />;
}

/**
 * ROK-1295 — Universal game research drawer.
 *
 * Right-slide panel on `≥md` (480px), bottom-sheet on `<md` (full-width,
 * anchored to viewport bottom). Backdrop, Esc, X-close, focus-trapped dialog.
 * Resolves by gameId (preferred) or by name (triggers ITAD→IGDB lookup).
 */
export function GameResearchDrawer({
    isOpen,
    onClose,
    gameId,
    name,
    action,
}: GameResearchDrawerProps) {
    const trapRef = useFocusTrap<HTMLDivElement>(isOpen);
    const dialogRef = useRef<HTMLDivElement>(null);
    const resolved = useResolvedGame(isOpen, gameId, name);
    useEscToClose(isOpen, onClose);
    useInitialFocus(isOpen, dialogRef);
    if (!isOpen) return null;
    const title = resolved.game?.name ?? name ?? 'Game research';
    return (
        <div
            ref={dialogRef}
            className="fixed inset-0"
            style={{ zIndex: Z_INDEX.MODAL }}
            data-testid="game-research-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Research: ${title}`}
            tabIndex={-1}
        >
            <div
                data-testid="game-research-drawer-backdrop"
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />
            <div
                ref={trapRef}
                data-testid="game-research-drawer-panel"
                className="absolute bg-surface flex flex-col overflow-hidden inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl md:inset-y-0 md:right-0 md:left-auto md:w-[480px] md:max-h-none md:rounded-none md:border-l md:border-edge-subtle"
            >
                <DrawerHeader title={title} onClose={onClose} />
                <div className="flex-1 overflow-y-auto">
                    <DrawerBody resolved={resolved} onClose={onClose} action={action} />
                </div>
            </div>
        </div>
    );
}
