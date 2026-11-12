/** The intro card's backdrop: neutral until "Tap to start", then the accent (ROK-2187). */
import type { JSX } from 'react';

/** Neutral → accent; the colour swap is instant under reduced motion. */
export function GgIntroBackground({ started }: { started: boolean }): JSX.Element {
    const tint = started ? 'from-success/30 via-surface to-backdrop' : 'from-panel via-surface to-backdrop';
    return <div aria-hidden="true" data-testid="gg-intro-bg" className={`absolute inset-0 bg-gradient-to-b transition-colors duration-1000 motion-reduce:transition-none ${tint}`} />;
}
