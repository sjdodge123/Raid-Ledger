/**
 * ROK-1870 — the game page's Taste Profile section as its own chunk: it sits
 * at the very bottom of the page (below the fold), so it stays out of the
 * `game-detail-page` bundle. A skeleton of the same shape holds its place.
 */
import { lazy, Suspense, type JSX } from 'react';

const GameTasteSection = lazy(() => import('./GameTasteSection').then((m) => ({ default: m.GameTasteSection })));

function TasteSectionSkeleton(): JSX.Element {
    return <div className="mb-8 h-48 animate-pulse rounded-lg border border-edge bg-surface" aria-busy="true" data-testid="game-taste-loading" />;
}

/** Lazy wrapper for `GameTasteSection` — same props. */
export function LazyGameTasteSection(props: { gameId: number | undefined }): JSX.Element {
    return (
        <Suspense fallback={<TasteSectionSkeleton />}>
            <GameTasteSection {...props} />
        </Suspense>
    );
}
