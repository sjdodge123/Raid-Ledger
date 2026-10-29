/**
 * Plugin hub widgets section for /dev/design-system (ROK-1909, design-system §4.27).
 *
 * The demo itself (hub-widgets-demo.tsx) loads lazily so it stays out of
 * DesignSystemPage's capped chunk — same split as forms-lazy-demos.tsx.
 */
import { Suspense, lazy, type JSX } from 'react';
import { Section } from './design-system-bits';

const HubWidgetsDemo = lazy(() => import('./hub-widgets-demo'));
const HubGalleryDemo = lazy(() => import('./hub-gallery-demo'));
const DeathsStripDemo = lazy(() => import('./deaths-strip-demo'));

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
            <h3 className="mt-6 text-sm font-semibold text-foreground">Gallery card + lightbox (§4.29, ROK-1942)</h3>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted"><span aria-hidden="true" className="inline-block h-4 w-8 rounded bg-media-well" /><code>bg-media-well</code> — the viewer's stage, near-black in every scheme (copy on it: <code>text-media-well-foreground</code>).</p>
            <p className="text-xs text-muted">Square thumbnail tiles; a tile opens the ONE dialog (Modal ≥1024px, BottomSheet below) in viewer mode — ←/→, Prev/Next, chips, editor Hide.</p>
            <Suspense fallback={<p className="text-xs text-muted">Loading gallery demo…</p>}>
                <HubGalleryDemo />
            </Suspense>
            <h3 className="mt-6 text-sm font-semibold text-foreground">Thumbnail strip in a meter row (ROK-1941)</h3>
            <p className="text-xs text-muted">A second line under a meter row, a sibling of the row link: up to three 40px thumbs in 44px targets, then "+N". A thumb opens the Gallery viewer above on Deaths at that picture; "+N" its grid.</p>
            <Suspense fallback={<p className="text-xs text-muted">Loading strip demo…</p>}>
                <DeathsStripDemo />
            </Suspense>
        </Section>
    );
}
