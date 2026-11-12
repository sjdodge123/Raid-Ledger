/**
 * Auto-advance for `StoryViewer` (ROK-2187, operator ruling 2026-11-12): each
 * slide moves on after its duration; the timer keeps the time left across a
 * pause. Paused by the player (Space / the play-pause button), a press-and-hold
 * on the tap zones, a hidden tab, the `paused` prop, or the current slide's
 * content (`useStoryControls().pause()`). Never runs past the last slide.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useDocumentHidden } from '../../hooks/use-document-hidden';
import { useHoldToPause, type HoldToPause } from './use-hold-to-pause';
import { belongsToOtherModal, isEditable } from './use-story-navigation';
import type { StoryControls } from './story-controls';

/** Default time on each slide (ms). */
export const DEFAULT_AUTO_ADVANCE_MS = 7000;

export interface StoryAutoplayOptions {
    index: number;
    atEnd: boolean;
    next: () => void;
    durationMs: number;
    /** False under reduced motion, `autoAdvance={false}` or an empty deck. */
    enabled: boolean;
    externalPaused: boolean;
    containerRef: RefObject<HTMLElement | null>;
}

export interface StoryAutoplay {
    enabled: boolean;
    /** Not advancing right now, for any reason. */
    paused: boolean;
    /** Paused by the player (Space / button) — what the play-pause button shows. */
    userPaused: boolean;
    durationMs: number;
    toggle: () => void;
    hold: HoldToPause;
    controls: StoryControls;
}

/** A button/link the player focused, other than our tap zones: Space is its own. */
function isForeignControl(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    const control = target.closest('a,button,summary,[role="button"]');
    return control !== null && !control.hasAttribute('data-story-tap');
}

function useSpaceToggle(containerRef: RefObject<HTMLElement | null>, toggle: () => void, enabled: boolean): void {
    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (e: KeyboardEvent): void => {
            if (e.key !== ' ' || e.repeat || e.defaultPrevented) return;
            if (isEditable(e.target) || isForeignControl(e.target) || belongsToOtherModal(e.target, containerRef.current)) return;
            e.preventDefault();
            toggle();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [containerRef, toggle, enabled]);
}

/** Calls `next` once `durationMs` of running time has passed on slide `index`. */
function useSlideTimer(index: number, durationMs: number, running: boolean, next: () => void): void {
    const left = useRef({ index, ms: durationMs });
    useEffect(() => {
        if (left.current.index !== index) left.current = { index, ms: durationMs };
        const slot = left.current;
        if (!running) return;
        const startedAt = Date.now();
        const id = window.setTimeout(next, slot.ms);
        return () => {
            window.clearTimeout(id);
            slot.ms = Math.max(0, slot.ms - (Date.now() - startedAt));
        };
    }, [index, durationMs, running, next]);
}

function useContentPause(index: number): { contentPaused: boolean; pause: () => void; resume: () => void } {
    const [pausedAt, setPausedAt] = useState<number | null>(null);
    const pause = useCallback((): void => setPausedAt(index), [index]);
    const resume = useCallback((): void => setPausedAt(null), []);
    return { contentPaused: pausedAt === index, pause, resume };
}

/** Auto-advance state + timer for a story deck. */
export function useStoryAutoplay(o: StoryAutoplayOptions): StoryAutoplay {
    const [userPaused, setUserPaused] = useState(false);
    const hidden = useDocumentHidden();
    const hold = useHoldToPause();
    const { contentPaused, pause, resume } = useContentPause(o.index);
    const toggle = useCallback((): void => setUserPaused((p) => !p), []);
    useSpaceToggle(o.containerRef, toggle, o.enabled);
    const paused = userPaused || hold.held || hidden || contentPaused || o.externalPaused;
    useSlideTimer(o.index, o.durationMs, o.enabled && !paused && !o.atEnd, o.next);
    const controls = useMemo(() => ({ pause, resume, paused: o.enabled && paused }), [pause, resume, paused, o.enabled]);
    return { enabled: o.enabled, paused, userPaused, durationMs: o.durationMs, toggle, hold, controls };
}
