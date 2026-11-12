/**
 * StoryViewer — a full-screen paged story (ROK-2187, first used by "GG <year>").
 *
 * Phone (<1024px): the story fills the viewport. Desktop/iPad landscape
 * (≥1024px, `DESKTOP_MQ`): a centred 9:16 portrait card with round side arrows.
 * Both: segmented progress, tap left half = back / right half = next, swipe,
 * ←/→ keys, Escape and × close. Never wraps. Auto-advances every
 * `autoAdvanceMs` (7 s) — see `use-story-autoplay.ts` for what pauses it;
 * reduced motion = tap only.
 *
 * A portalled `aria-modal` dialog with a focus trap, a ref-counted body scroll
 * lock and an Escape layer (a sheet opened above it closes first). The current
 * slide is a `role="group"` `aria-roledescription="slide"` and a polite live
 * region announces each move. Reduced motion drops the slide entrance; slides
 * own their backgrounds (`KenBurnsBackground` respects it too).
 *
 * Slide content sits above the tap zones with `pointer-events: none`; links,
 * buttons, fields, labels and iframes inside it opt back in, so a control on a
 * slide is pressable while the empty space around it still pages.
 */
import { createPortal } from 'react-dom';
import { type JSX, type ReactNode, type RefObject } from 'react';
import { useFocusTrap } from '../../hooks/use-focus-trap';
import { useBodyScrollLock } from '../../hooks/use-body-scroll-lock';
import { useEscapeLayer } from '../../hooks/use-escape-layer';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { Z_INDEX } from '../../lib/z-index';
import { useStoryNavigation, type StoryNavigation } from './use-story-navigation';
import {
    ProgressSegments, SideArrow, StoryCloseButton, StoryLiveRegion, StoryPlayPauseButton, TapZones,
} from './story-viewer.parts';
import { DEFAULT_AUTO_ADVANCE_MS, useStoryAutoplay, type StoryAutoplay } from './use-story-autoplay';
import { StoryControlsContext } from './story-controls';
import { usePrefersReducedMotion } from '../../hooks/use-prefers-reduced-motion';

export { KenBurnsBackground } from './story-viewer.parts';

/** One page of the story. */
export interface StorySlide {
    /** Stable key (also remounts the slide so its entrance animation replays). */
    id: string;
    /** Short name announced by the live region and used as the slide's accessible name. */
    label: string;
    /** The slide body, or a function rendering it (called only while the slide is current). */
    content: ReactNode | (() => ReactNode);
    /** Painted behind the body, e.g. `<KenBurnsBackground src=… />`. Default: `bg-surface`. */
    background?: ReactNode;
    /** Time on this slide before auto-advance (ms), e.g. longer for a trailer. Default: `autoAdvanceMs`. */
    durationMs?: number;
}

export interface StoryViewerProps {
    /** Dialog name and header text, e.g. "GG 2026"; the × is "Close <title>". */
    title: string;
    slides: readonly StorySlide[];
    onClose: () => void;
    /** Slide to open on (clamped to the deck). Default 0. */
    initialIndex?: number;
    /** Fires after every real move (never at a bound). */
    onIndexChange?: (index: number) => void;
    /** Extra header controls between the title and the × (a year switcher, a media toggle). */
    headerExtra?: ReactNode;
    /** Auto-advance on (default). Always off under `prefers-reduced-motion`. */
    autoAdvance?: boolean;
    /** Time on each slide before it moves on (ms). Default 7000. */
    autoAdvanceMs?: number;
    /** Hold the auto-advance from outside (slide content can use `useStoryControls()` instead). */
    paused?: boolean;
}

const SLIDE_INTERACTIVE = '[&_:is(a,button,input,select,textarea,label,iframe)]:pointer-events-auto';
const SLIDE_ENTER = 'animate-[story-slide-in_0.35s_var(--spring-smooth)_both]';

function SlideBody({ slide, index, count, reduced }: {
    slide: StorySlide; index: number; count: number; reduced: boolean;
}): JSX.Element {
    const body = typeof slide.content === 'function' ? slide.content() : slide.content;
    return (
        <div role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${count}: ${slide.label}`}
            className={`pointer-events-none absolute inset-0 z-20 flex flex-col gap-3 px-6 pb-7 pt-24 ${SLIDE_INTERACTIVE} ${reduced ? '' : SLIDE_ENTER}`}>
            {body}
        </div>
    );
}

function StoryHeader({ title, index, count, onClose, extra, autoplay }: {
    title: string; index: number; count: number; onClose: () => void; extra: ReactNode; autoplay: StoryAutoplay;
}): JSX.Element {
    const timing = autoplay.enabled ? { durationMs: autoplay.durationMs, running: !autoplay.paused } : undefined;
    return (
        <div className="absolute inset-x-0 top-0 z-30 px-3 pt-3">
            <ProgressSegments count={count} index={index} timing={timing} />
            <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-semibold leading-tight text-foreground">
                    {title}
                    <small className="block font-medium text-muted">{`${index + 1} of ${count}`}</small>
                </span>
                {extra}
                <div className="ml-auto flex items-center">
                    {autoplay.enabled && <StoryPlayPauseButton paused={autoplay.userPaused} onToggle={autoplay.toggle} />}
                    <StoryCloseButton title={title} onClose={onClose} />
                </div>
            </div>
        </div>
    );
}

const STAGE_PHONE = 'h-dvh w-full';
const STAGE_DESKTOP = 'aspect-[9/16] h-[calc(100dvh-48px)] max-w-[min(400px,calc(100vw-160px))] rounded-xl border border-edge';

interface StageProps {
    props: StoryViewerProps;
    nav: StoryNavigation;
    desktop: boolean;
    autoplay: StoryAutoplay;
}

function StoryStage({ props, nav, desktop, autoplay }: StageProps): JSX.Element | null {
    const reduced = usePrefersReducedMotion();
    const slide = props.slides[nav.index];
    if (!slide) return null;
    const count = props.slides.length;
    return (
        <div data-testid="story-stage" onTouchStart={nav.onTouchStart} onTouchEnd={nav.onTouchEnd}
            className={`relative select-none overflow-hidden bg-surface text-foreground ${desktop ? STAGE_DESKTOP : STAGE_PHONE}`}>
            {slide.background && <div className="absolute inset-0">{slide.background}</div>}
            <TapZones onPrev={nav.prev} onNext={nav.next} pointerOnly={desktop} hold={autoplay.hold} />
            <SlideBody key={slide.id} slide={slide} index={nav.index} count={count} reduced={reduced} />
            <StoryHeader title={props.title} index={nav.index} count={count} onClose={props.onClose} extra={props.headerExtra} autoplay={autoplay} />
            <StoryLiveRegion index={nav.index} count={count} label={slide.label} />
        </div>
    );
}

function autoplayState(a: StoryAutoplay): 'off' | 'paused' | 'running' {
    if (!a.enabled) return 'off';
    return a.paused ? 'paused' : 'running';
}

function StoryShell({ containerRef, ...stage }: StageProps & { containerRef: RefObject<HTMLDivElement | null> }): JSX.Element {
    const { props, nav, desktop } = stage;
    return (
        <div ref={containerRef} role="dialog" aria-modal="true" aria-label={props.title}
            data-testid="story-viewer" data-layout={desktop ? 'desktop' : 'phone'} data-autoplay={autoplayState(stage.autoplay)} style={{ zIndex: Z_INDEX.MODAL }}
            className={`fixed inset-0 flex items-center justify-center bg-backdrop ${desktop ? 'gap-6' : ''}`}>
            {desktop && <SideArrow dir="prev" disabled={nav.atStart} onClick={nav.prev} />}
            <StoryStage {...stage} />
            {desktop && <SideArrow dir="next" disabled={nav.atEnd} onClick={nav.next} />}
        </div>
    );
}

function useViewerAutoplay(props: StoryViewerProps, nav: StoryNavigation, containerRef: RefObject<HTMLDivElement | null>): StoryAutoplay {
    const reduced = usePrefersReducedMotion();
    return useStoryAutoplay({
        index: nav.index, atEnd: nav.atEnd, next: nav.next, containerRef,
        durationMs: props.slides[nav.index]?.durationMs ?? props.autoAdvanceMs ?? DEFAULT_AUTO_ADVANCE_MS,
        enabled: props.autoAdvance !== false && !reduced && props.slides.length > 0,
        externalPaused: props.paused === true,
    });
}

/** Full-screen paged story; mount it to open, unmount (from `onClose`) to close. */
export function StoryViewer(props: StoryViewerProps): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const containerRef = useFocusTrap<HTMLDivElement>(true);
    useEscapeLayer(true, props.onClose);
    useBodyScrollLock(true);
    const nav = useStoryNavigation(props.slides.length, props.initialIndex ?? 0, containerRef, props.onIndexChange);
    const autoplay = useViewerAutoplay(props, nav, containerRef);
    return createPortal(
        <StoryControlsContext.Provider value={autoplay.controls}>
            <StoryShell props={props} nav={nav} desktop={desktop} autoplay={autoplay} containerRef={containerRef} />
        </StoryControlsContext.Provider>,
        document.body,
    );
}
