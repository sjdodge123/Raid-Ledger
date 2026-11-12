/**
 * StoryViewer section for /dev/design-system (ROK-2187, design-system §4.34).
 * The demo loads lazily, same split as wizard-substep-rail-section.tsx.
 */
import { Suspense, lazy, type JSX } from 'react';
import { Section } from './design-system-bits';

const StoryViewerDemo = lazy(() => import('./story-viewer-demo'));

/** §4.34 — the full-screen paged story (GG <year>). */
export function StoryViewerSection(): JSX.Element {
    return (
        <Section
            id="story-viewer"
            title="Pattern — story viewer"
            blurb="A full-screen paged story, not a dialog of content: segmented progress, tap the right half (or →, or swipe left) for next and the left half for back, Esc or × closes. Auto-advances every 7 s (the segment fills); hold, Space, the ⏸ button, a hidden tab or the slide's own content pause it; stops at the last slide, never wraps; reduced motion = tap only. Phone = full screen; from 1024px a centred 9:16 card with side arrows. Reduced motion drops the slide entrance and the Ken Burns pan."
        >
            <div data-testid="ds-story-viewer">
                <Suspense fallback={<p className="text-xs text-muted">Loading story viewer demo…</p>}>
                    <StoryViewerDemo />
                </Suspense>
            </div>
        </Section>
    );
}
