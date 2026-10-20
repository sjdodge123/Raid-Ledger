/** ROK-1854 — the lazy shell registered as the hub’s Planner tab. */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';

const PlannerHubTab = lazy(() => import('./valheim-planner-hub-tab'));

/** The registered Planner tab component — loads its chunk on first render. */
export function LazyValheimPlannerHubTab(ctx: HubCtx): JSX.Element {
    return (
        <Suspense fallback={null}>
            <PlannerHubTab {...ctx} />
        </Suspense>
    );
}
