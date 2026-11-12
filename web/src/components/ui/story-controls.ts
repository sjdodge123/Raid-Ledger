/**
 * Auto-advance controls a slide's own content can reach (ROK-2187): a trailer
 * card calls `pause()` while it plays and `resume()` when it stops. A pause is
 * scoped to the slide that asked for it — moving to another slide drops it.
 */
import { createContext, useContext } from 'react';

export interface StoryControls {
    /** Hold the auto-advance on the current slide. */
    pause: () => void;
    /** Release a `pause()` from this slide's content. */
    resume: () => void;
    /** True while the story is not advancing for any reason (user, hold, hidden tab, content). */
    paused: boolean;
}

const NOOP: StoryControls = { pause: () => {}, resume: () => {}, paused: false };

export const StoryControlsContext = createContext<StoryControls>(NOOP);

/** The enclosing `StoryViewer`'s auto-advance controls (no-ops outside one). */
export function useStoryControls(): StoryControls {
    return useContext(StoryControlsContext);
}
