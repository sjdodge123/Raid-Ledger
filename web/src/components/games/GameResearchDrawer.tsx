/**
 * ROK-1297 (round 5y): the prior side-drawer is replaced with a straight
 * navigation to `/games/:id`. Every callsite still mounts
 * `<GameResearchDrawer isOpen onClose gameId={n} />` — instead of opening
 * an overlay we route the browser to the canonical detail page so the
 * viewer gets the full owners / players / activity / pricing surface
 * (and back-button history works naturally).
 *
 * When only `name` is known (inline body-text refs via GameRef), the
 * existing ITAD→IGDB name-lookup resolves the id first, then we navigate.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameLookupByName } from '../../hooks/use-game-lookup-by-name';
import type { DrawerAction } from './drawer-action-row';

export type { DrawerAction };

interface GameResearchDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    /** Resolve by gameId (preferred when known). */
    gameId?: number;
    /** Resolve by free-text name (triggers POST /games/lookup-by-name). */
    name?: string;
    /**
     * Legacy prop retained for callsite-shape compatibility. The
     * previous drawer rendered a CTA from this; navigation supersedes it.
     */
    action?: DrawerAction;
}

export function GameResearchDrawer({
    isOpen,
    onClose,
    gameId,
    name,
}: GameResearchDrawerProps) {
    const navigate = useNavigate();
    const lookupEnabled = isOpen && gameId == null && !!name;
    const lookup = useGameLookupByName(name, lookupEnabled);
    const resolvedId = gameId ?? lookup.data?.id;
    // ROK-1297 round 5aa: track the last id we navigated to within this
    // open cycle. React StrictMode double-invokes effects in dev (and
    // any dep-change re-run could refire), so without this guard the
    // browser logged two history entries on /games/:id and the user had
    // to press Back twice. Reset when the drawer closes.
    const lastNavigatedRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isOpen) {
            lastNavigatedRef.current = null;
            return;
        }
        if (resolvedId == null) return;
        if (lastNavigatedRef.current === resolvedId) return;
        lastNavigatedRef.current = resolvedId;
        navigate(`/games/${resolvedId}`);
        onClose();
    }, [isOpen, resolvedId, navigate, onClose]);

    return null;
}
