/**
 * Arrange list section for /dev/design-system (ROK-1918, design-system §4.28).
 *
 * The demo (arrange-list-demo.tsx) loads lazily so it stays out of
 * DesignSystemPage's capped chunk — same split as hub-widgets-section.tsx.
 */
import { Suspense, lazy, type JSX } from 'react';
import { Section } from './design-system-bits';

const ArrangeListDemo = lazy(() => import('./arrange-list-demo'));

/** §4.28 — reorder / hide rows of a configurable widget grid. */
export function ArrangeListSection(): JSX.Element {
    return (
        <Section
            id="arrange-list"
            title="Pattern — arrange list"
            blurb="An order-truthful list that stands in for a configurable grid while it is edited: Move up / Move down on every row (keyboard + touch), native drag on the grip at ≥1024px with a fine pointer, a pressed-state Hide that keeps the row in place dimmed, and a polite live region. Changes are staged until Save."
        >
            <div data-testid="ds-arrange-list">
                <Suspense fallback={<p className="text-xs text-muted">Loading arrange demo…</p>}>
                    <ArrangeListDemo />
                </Suspense>
            </div>
        </Section>
    );
}
