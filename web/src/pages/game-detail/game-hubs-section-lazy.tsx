/**
 * ROK-1870 / ROK-1883 — the game page's Hubs card (and its propose dialog) as
 * its own chunk: only signed-in viewers render it, so it stays out of the
 * `game-detail-page` bundle. A small skeleton holds its place while it loads.
 */
import { lazy, Suspense, type JSX } from 'react';

const GameHubsSection = lazy(() => import('./game-hubs-section').then((m) => ({ default: m.GameHubsSection })));

function HubsCardSkeleton(): JSX.Element {
    return <div className="mb-8 h-24 animate-pulse rounded-lg border border-edge bg-surface" aria-busy="true" data-testid="game-hubs-loading" />;
}

/** Lazy wrapper for `GameHubsSection` — same props. */
export function LazyGameHubsSection(props: { gameId: number; gameName: string }): JSX.Element {
    return (
        <Suspense fallback={<HubsCardSkeleton />}>
            <GameHubsSection {...props} />
        </Suspense>
    );
}
