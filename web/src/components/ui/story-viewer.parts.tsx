/**
 * The pieces `StoryViewer` composes (ROK-2187): progress segments, the close
 * button, the two tap zones, the desktop side arrows, the polite live region
 * and `KenBurnsBackground`. Tokens only — every colour remaps with the scheme.
 */
import type { JSX } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from './button';
import { FOCUS_RING } from './form-classes';
import { usePrefersReducedMotion } from '../../hooks/use-prefers-reduced-motion';

type SegmentState = 'done' | 'current' | 'upcoming';

function segmentState(k: number, index: number): SegmentState {
    if (k < index) return 'done';
    return k === index ? 'current' : 'upcoming';
}

/** One thin bar per slide; filled up to and including the current one. Decorative (the live region speaks). */
export function ProgressSegments({ count, index }: { count: number; index: number }): JSX.Element {
    return (
        <div className="flex gap-1" aria-hidden="true">
            {Array.from({ length: count }, (_, k) => {
                const state = segmentState(k, index);
                return (
                    <span key={k} data-testid="story-progress-segment" data-state={state}
                        className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/20">
                        <span className={`block h-full rounded-full bg-foreground ${state === 'upcoming' ? 'w-0' : 'w-full'}`} />
                    </span>
                );
            })}
        </div>
    );
}

/** The × in the story header, named "Close <title>". */
export function StoryCloseButton({ title, onClose }: { title: string; onClose: () => void }): JSX.Element {
    return (
        <Button variant="ghost" iconOnly aria-label={`Close ${title}`} onClick={onClose} className="ml-auto text-foreground">
            <XMarkIcon className="h-6 w-6" aria-hidden="true" />
        </Button>
    );
}

const TAP_ZONE = `absolute top-20 bottom-0 z-10 w-1/2 cursor-pointer bg-transparent ${FOCUS_RING}`;

/**
 * Left half = back, right half = next (mockup). On desktop the side arrows are
 * the keyboard/AT controls, so there the zones leave the tab order.
 */
export function TapZones({ onPrev, onNext, pointerOnly }: {
    onPrev: () => void;
    onNext: () => void;
    pointerOnly: boolean;
}): JSX.Element {
    const a11y = pointerOnly ? { tabIndex: -1, 'aria-hidden': true as const } : {};
    return (
        <>
            <button type="button" aria-label="Previous slide" onClick={onPrev} className={`${TAP_ZONE} left-0`} {...a11y} />
            <button type="button" aria-label="Next slide" onClick={onNext} className={`${TAP_ZONE} right-0`} {...a11y} />
        </>
    );
}

/** A 48px round arrow beside the desktop card; disabled at the deck's bounds. */
export function SideArrow({ dir, disabled, onClick }: {
    dir: 'prev' | 'next';
    disabled: boolean;
    onClick: () => void;
}): JSX.Element {
    const Icon = dir === 'prev' ? ChevronLeftIcon : ChevronRightIcon;
    return (
        <Button variant="secondary" iconOnly aria-label={dir === 'prev' ? 'Previous slide' : 'Next slide'}
            data-testid={`story-side-arrow-${dir}`} disabled={disabled} onClick={onClick}
            className="h-12 w-12 shrink-0 rounded-full">
            <Icon className="h-5 w-5" aria-hidden="true" />
        </Button>
    );
}

/** Polite announcement of the current slide ("Slide 2 of 10: Events"). */
export function StoryLiveRegion({ index, count, label }: { index: number; count: number; label: string }): JSX.Element {
    return <p role="status" aria-live="polite" className="sr-only">{`Slide ${index + 1} of ${count}: ${label}`}</p>;
}

/**
 * A slowly panning, zooming screenshot behind a slide (CSS `story-ken-burns`
 * keyframes in index.css). Reduced motion = the same image, static. Without a
 * `src` it paints a token gradient so text keeps its contrast.
 */
export function KenBurnsBackground({ src, className = '' }: { src?: string | undefined; className?: string }): JSX.Element {
    const reduced = usePrefersReducedMotion();
    return (
        <div aria-hidden="true" className={`absolute inset-0 overflow-hidden bg-gradient-to-b from-panel to-backdrop ${className}`}>
            {src && (
                <img src={src} alt="" data-testid="ken-burns-image" data-motion={reduced ? 'static' : 'ken-burns'}
                    className={`absolute -inset-[8%] h-[116%] w-[116%] max-w-none object-cover ${reduced ? '' : 'origin-[30%_40%] animate-[story-ken-burns_16s_ease-in-out_infinite_alternate]'}`} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-backdrop/90 via-backdrop/40 to-backdrop/70" />
        </div>
    );
}
