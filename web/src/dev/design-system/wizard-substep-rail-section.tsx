/**
 * Wizard sub-step rail section for /dev/design-system (ROK-1703, design-system §4.33).
 *
 * The demo loads lazily so the onboarding rail stays out of DesignSystemPage's
 * capped chunk — same split as masonry-grid-section.tsx.
 */
import { Suspense, lazy, type JSX } from 'react';
import { Section } from './design-system-bits';

const WizardSubstepRailDemo = lazy(() => import('./wizard-substep-rail-demo'));

/** §4.33 — one top-level wizard step holding several short screens behind a rail. */
export function WizardSubstepRailSection(): JSX.Element {
    return (
        <Section
            id="wizard-substep-rail"
            title="Pattern — wizard sub-step rail"
            blurb="One top-level wizard step with several short screens (the setup wizard's Discord step) gets a rail inside the step, never more stepper dots. From 1024px it is a titled vertical list: done = success check, current = success ring + overlay row with aria-current, upcoming = muted. Below 1024px it collapses to one 'Connect Discord · n of 5' line — narrow the window to see it."
        >
            <div data-testid="ds-wizard-substep-rail">
                <Suspense fallback={<p className="text-xs text-muted">Loading rail demo…</p>}>
                    <WizardSubstepRailDemo />
                </Suspense>
            </div>
        </Section>
    );
}
