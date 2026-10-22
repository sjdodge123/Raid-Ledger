/**
 * ROK-1876 — the lazy shell registered as the server hub's "Server hours"
 * Overview widget. `register-hub.ts` loads with the Pelican plugin at boot, so
 * a direct import put the widget, its helpers and the timezone store in the
 * app-entry chunk (bundle budget); the widget now loads on first render.
 */
import { lazy, Suspense, type JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { WidgetCard } from '../../../components/hub/hub-bits';

const ServerHoursWidget = lazy(() => import('./server-hours-widget').then((m) => ({ default: m.ServerHoursWidget })));

/** Holds the card's place while the chunk loads, so the Overview cards below it do not shift. WidgetCard already ships in app-entry (Recent arrivals). */
const FALLBACK = (
    <WidgetCard id="server-hub-hours" title="Server hours">
        <p className="py-2 text-sm text-muted" data-testid="server-hub-hours-fallback">Loading hours…</p>
    </WidgetCard>
);

/** The registered widget component — loads the hours chunk on first render. */
export function LazyServerHoursWidget(ctx: HubCtx): JSX.Element {
    return (
        <Suspense fallback={FALLBACK}>
            <ServerHoursWidget {...ctx} />
        </Suspense>
    );
}
