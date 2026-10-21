/**
 * ROK-1876 — the lazy shell registered as the server hub's "Server hours"
 * Overview widget. `register-hub.ts` loads with the Pelican plugin at boot, so
 * a direct import put the widget, its helpers and the timezone store in the
 * app-entry chunk (bundle budget); the widget now loads on first render.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';

const ServerHoursWidget = lazy(() => import('./server-hours-widget').then((m) => ({ default: m.ServerHoursWidget })));

/** The registered widget component — loads the hours chunk on first render. */
export function LazyServerHoursWidget(ctx: HubCtx): JSX.Element {
    return (
        <Suspense fallback={null}>
            <ServerHoursWidget {...ctx} />
        </Suspense>
    );
}
