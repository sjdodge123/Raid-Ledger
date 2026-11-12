import { useMediaQuery } from './use-media-query';

/** The reduced-motion media query (ROK-2187 StoryViewer, KenBurnsBackground). */
export const REDUCED_MOTION_MQ = '(prefers-reduced-motion: reduce)';

/** True while the OS asks for reduced motion: drop pan/zoom and entrance animations. */
export function usePrefersReducedMotion(): boolean {
    return useMediaQuery(REDUCED_MOTION_MQ);
}
