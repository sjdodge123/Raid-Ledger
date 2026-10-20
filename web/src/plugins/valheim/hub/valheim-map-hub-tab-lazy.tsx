/** ROK-1837 — the lazy shell registered as the hub's Map tab (keeps the map out of `hub-page`). */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';

const MapHubTab = lazy(() => import('./valheim-map-hub-tab'));

/** The registered Map tab component — loads the map chunk on first render. */
export function LazyValheimMapHubTab(ctx: HubCtx): JSX.Element {
    return (
        <Suspense fallback={null}>
            <MapHubTab {...ctx} />
        </Suspense>
    );
}
