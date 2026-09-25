/**
 * ROK-1661 diagnostic rows for the DEMO_MODE viewport readout (`ViewportReadout.tsx`):
 * the numbers that tell a real on-screen keyboard from a phantom bottom inset
 * Safari can leave behind after tab or keyboard switching.
 *
 * `icb − vv` (documentElement.clientHeight − visualViewport.height) is the key
 * discriminator: ~132 at rest on iPad with the toolbar, ~170 with favourites;
 * over ~240 with no editable element focused means a bottom inset with no keyboard.
 */

export type Reading = readonly [label: string, value: string];

export interface LastEvent {
    name: string;
    /** `Date.now()` when it fired. */
    at: number;
}

type Watched = readonly [target: EventTarget | null | undefined, type: string, name: string];

export function readIcbGap(): string {
    const vv = window.visualViewport;
    if (!vv) return '-';
    return String(Math.round((document.documentElement.clientHeight - vv.height) * 100) / 100);
}

export function readActiveElement(): string {
    const el = document.activeElement;
    if (!el || el === document.body) return 'none';
    if (el instanceof HTMLInputElement) return `input[${el.type}]`;
    return el.tagName.toLowerCase();
}

export function readScreen(): string {
    return `${window.screen.width}×${window.screen.height} · inner ${window.innerWidth}`;
}

export function readVisibility(): string {
    return document.visibilityState;
}

export function formatLastEvent(event: LastEvent | null, now: number): string {
    return event ? `${event.name} ${Math.max(0, now - event.at)}ms ago` : 'none';
}

export function readSignals(lastEvent: LastEvent | null): Reading[] {
    return [
        ['icb − vv', readIcbGap()],
        ['activeElement', readActiveElement()],
        ['screen', readScreen()],
        ['visibility', readVisibility()],
        ['last event', formatLastEvent(lastEvent, Date.now())],
    ];
}

/** Calls `onEvent` with a short name for each viewport, focus and page-lifecycle event; returns the cleanup. */
export function watchViewportEvents(onEvent: (name: string) => void): () => void {
    const vv = window.visualViewport;
    const watched: Watched[] = [
        [vv, 'resize', 'vv.resize'],
        [vv, 'scroll', 'vv.scroll'],
        [window, 'resize', 'resize'],
        [document, 'focusin', 'focusin'],
        [document, 'focusout', 'focusout'],
        [window, 'pageshow', 'pageshow'],
        [document, 'visibilitychange', 'visibilitychange'],
    ];
    const handlers = watched.map(([target, type, name]) => {
        const handler = () => onEvent(name);
        target?.addEventListener(type, handler);
        return () => target?.removeEventListener(type, handler);
    });
    return () => handlers.forEach((remove) => remove());
}
