/**
 * Masonry-packed card grid section for /dev/design-system (ROK-2043, design-system §4.31).
 *
 * The demo (masonry-grid-demo.tsx) loads lazily so it stays out of
 * DesignSystemPage's capped chunk — same split as arrange-list-section.tsx.
 */
import { Suspense, lazy, type JSX } from 'react';
import { Section } from './design-system-bits';

const MasonryGridDemo = lazy(() => import('./masonry-grid-demo'));

/** §4.31 — the hub Overview bento: cards keep order and span and slide up under the card above. */
export function MasonryGridSection(): JSX.Element {
    return (
        <Section
            id="masonry-grid"
            title="Pattern — masonry-packed card grid"
            blurb="The hub Overview bento from 768px: each card keeps its arranged slot and column span and starts one gap below the card above it, so a short card leaves no row-tall hole. Below 768px it is a plain stack. Widen the window past 768px / 1024px to see two and three columns."
        >
            <div data-testid="ds-masonry-grid">
                <Suspense fallback={<p className="text-xs text-muted">Loading masonry demo…</p>}>
                    <MasonryGridDemo />
                </Suspense>
            </div>
        </Section>
    );
}
