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

const FIELD = 'input, select, textarea';
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
 * Retries `focusSettingsSection` until the section exists, then lets go — so a
 * later re-render never steals focus back. Each attempt is a `setTimeout(0)`,
 * which runs after the shell's own open-focus (BottomSheet's timer, Modal's
 * trap effect), so the target wins. Returns the cleanup.
 */
function watchForSection(host: HTMLElement, id: string): () => void {
    let done = false;
    let timer: number | undefined;
    const observer = new MutationObserver(() => {
        if (!done && timer === undefined) timer = window.setTimeout(tryNow, 0);
    });
    function tryNow(): void {
        timer = undefined;
        if (done || !focusSettingsSection(host, id)) return;
        done = true;
        observer.disconnect();
    }
    observer.observe(host, { childList: true, subtree: true });
    timer = window.setTimeout(tryNow, 0);
    return () => { done = true; observer.disconnect(); window.clearTimeout(timer); };
}

/** Lands the open sheet on `section` (no-op when undefined); `root` is the sheet body. */
export function useSettingsSectionFocus(root: HTMLElement | null, section: string | undefined): void {
    useEffect(() => {
        if (root === null || section === undefined) return;
        return watchForSection(root, section);
    }, [root, section]);
}
