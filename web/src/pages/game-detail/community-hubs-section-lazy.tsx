/**
 * ROK-1870 — the game page's Community hubs card (and its propose dialog) as
 * its own chunk: only signed-in viewers render it, so it stays out of the
 * `game-detail-page` bundle. A small skeleton holds its place while it loads.
 */
import { lazy, Suspense, type JSX } from 'react';

const CommunityHubsSection = lazy(() => import('./community-hubs-section').then((m) => ({ default: m.CommunityHubsSection })));

function HubsCardSkeleton(): JSX.Element {
    return <div className="mb-8 h-24 animate-pulse rounded-lg border border-edge bg-surface" aria-busy="true" data-testid="community-hubs-loading" />;
}

/** Lazy wrapper for `CommunityHubsSection` — same props. */
export function LazyCommunityHubsSection(props: { gameId: number; gameName: string }): JSX.Element {
    return (
        <Suspense fallback={<HubsCardSkeleton />}>
            <CommunityHubsSection {...props} />
        </Suspense>
    );
}
