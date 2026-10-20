/** ROK-1836 — the lazy shell registered as the hub's Characters tab (keeps `hub-page` flat). */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';

const CharactersHubTab = lazy(() => import('./valheim-characters-hub-tab'));

export function LazyValheimCharactersHubTab(ctx: HubCtx): JSX.Element {
    return (
        <Suspense fallback={null}>
            <CharactersHubTab {...ctx} />
        </Suspense>
    );
}
