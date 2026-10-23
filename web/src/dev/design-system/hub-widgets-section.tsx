/**
 * Plugin hub widgets section for /dev/design-system (ROK-1909, design-system §4.27).
 *
 * The demo itself (hub-widgets-demo.tsx) loads lazily so it stays out of
 * DesignSystemPage's capped chunk — same split as forms-lazy-demos.tsx.
 */
import { Suspense, lazy, type JSX } from 'react';
import { Section } from './design-system-bits';

const HubWidgetsDemo = lazy(() => import('./hub-widgets-demo'));

/** §4.27 — a plugin's game-scoped Overview card in its three states. */
export function HubWidgetsSection(): JSX.Element {
    return (
        <Section
            id="hub-widgets"
            title="Pattern — plugin hub widgets"
            blurb="registerHubWidget cards on a hub Overview: core draws the WidgetCard chrome, a Suspense skeleton and an error boundary that keeps a throwing body inside its own card. Audience is a client-side display filter; members-only data endpoints must also enforce access server-side."
        >
            <div data-testid="ds-hub-widgets">
                <Suspense fallback={<p className="text-xs text-muted">Loading widget demo…</p>}>
                    <HubWidgetsDemo />
                </Suspense>
            </div>
        </Section>
    );
}
