/** ROK-1853 — the lazy shell registered as the hub's Materials tab. */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';

const MaterialsHubTab = lazy(() => import('./valheim-materials-hub-tab'));

/** The registered Materials tab component — loads its chunk on first render. */
export function LazyValheimMaterialsHubTab(ctx: HubCtx): JSX.Element {
    return (
        <Suspense fallback={null}>
            <MaterialsHubTab {...ctx} />
        </Suspense>
    );
}
