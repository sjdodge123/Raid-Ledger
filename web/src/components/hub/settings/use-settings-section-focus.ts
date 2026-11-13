/**
 * ROK-2188 — open the hub settings sheet AT a named section: once the section
 * renders (a plugin section such as the WoW Blizzard roster appears only after
 * its own query resolves), scroll it to the top of the sheet's scroll
 * container (the Modal body on desktop, the BottomSheet body on phone) and
 * focus its first field. The scroll is instant (never smooth), so it is
 * motion-free under `prefers-reduced-motion` too.
 */
import { useEffect } from 'react';

/** The attribute `SettingsSection` stamps from its `sectionId`. */
export const SETTINGS_SECTION_ATTR = 'data-settings-section';

/** A real field: never a hidden input or a disabled control. */
const FIELD = 'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

function findSection(root: HTMLElement, section: string): HTMLElement | null {
    const all = root.querySelectorAll<HTMLElement>(`[${SETTINGS_SECTION_ATTR}]`);
    return Array.from(all).find((el) => el.getAttribute(SETTINGS_SECTION_ATTR) === section) ?? null;
}

/** The nearest ancestor that scrolls vertically — the Modal body or the BottomSheet body. */
function scrollParent(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
        const y = window.getComputedStyle(p).overflowY;
        if (y === 'auto' || y === 'scroll') return p;
    }
    return null;
}

/**
 * Scroll ONLY the sheet's own scroller: `scrollIntoView` would also scroll an
 * `overflow:hidden` ancestor (the BottomSheet's fixed layer, mid-slide) and
 * knock the sheet out of place. Rect deltas are transform-safe.
 */
function scrollToTop(el: HTMLElement): void {
    const scroller = scrollParent(el);
    if (scroller === null) {
        el.scrollIntoView({ block: 'start', behavior: 'auto' });
        return;
    }
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

/** Scrolls to + focuses `section` inside `root`; false while it has not rendered yet. */
export function focusSettingsSection(root: HTMLElement, section: string): boolean {
    const el = findSection(root, section);
    if (el === null) return false;
    scrollToTop(el);
    const target = el.querySelector<HTMLElement>(FIELD) ?? el.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus({ preventScroll: true });
    return true;
}

/**
 * How long after open a late section may still take focus. Past it the user
 * is likely editing something else, and a late arrival (a roster query on its
 * third retry) must not yank scroll and focus away from them.
 */
export const SECTION_FOCUS_WINDOW_MS = 2000;

/**
 * Runs `run` after BOTH shells' own open-focus: the Modal trap focuses its
 * first control in a `requestAnimationFrame` and the BottomSheet in a
 * `setTimeout(0)`, both queued before this — a frame then a task lands after
 * either. Returns the cancel.
 */
function afterShellFocus(run: () => void): () => void {
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => { timer = window.setTimeout(run, 0); });
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
}

/**
 * Retries `focusSettingsSection` as `host` changes until the section lands —
 * then lets go for good, so a re-render or refetch never steals focus back —
 * or until `windowMs` has passed. Returns the cleanup.
 */
export function watchForSection(host: HTMLElement, id: string, windowMs: number = SECTION_FOCUS_WINDOW_MS): () => void {
    let done = false;
    let cancelAttempt: (() => void) | null = null;
    const observer = new MutationObserver(() => schedule());
    const deadline = window.setTimeout(() => stop(), windowMs);
    function stop(): void {
        done = true;
        observer.disconnect();
        window.clearTimeout(deadline);
        cancelAttempt?.();
        cancelAttempt = null;
    }
    function schedule(): void {
        if (!done && cancelAttempt === null) cancelAttempt = afterShellFocus(tryNow);
    }
    function tryNow(): void {
        cancelAttempt = null;
        if (!done && focusSettingsSection(host, id)) stop();
    }
    observer.observe(host, { childList: true, subtree: true });
    schedule();
    return stop;
}

/** Lands the open sheet on `section` (no-op when undefined); `root` is the sheet body. */
export function useSettingsSectionFocus(root: HTMLElement | null, section: string | undefined): void {
    useEffect(() => {
        if (root === null || section === undefined) return;
        return watchForSection(root, section);
    }, [root, section]);
}
