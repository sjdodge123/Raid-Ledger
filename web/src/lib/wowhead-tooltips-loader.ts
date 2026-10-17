/**
 * ROK-1366: load Wowhead's tooltips.js from the entry, never from index.html.
 *
 * app-entry.tsx imports this module last — after main.tsx's first import
 * (`./lib/magic-link-capture`) stripped the `#token=` fragment, and after the
 * app graph ran `lib/api/native-fetch.ts` (ROK-1779), so the third-party
 * script can neither read the token nor patch fetch/XHR before the capture —
 * the ordering holds by construction, not by HTML attribute semantics. The script is `async`, so it does not hold DOMContentLoaded (a
 * `defer` tag after the entry did, and changed the boot order smoke relies on).
 *
 * The `whTooltips` config stays an inline script in index.html's <head>, so it
 * is always defined before this script runs. Keep this module import-free
 * (magic-link-capture.test.ts pins it).
 */
export const WOWHEAD_TOOLTIPS_SRC = 'https://wow.zamimg.com/js/tooltips.js';

/** Append the async tooltips.js <script> once; later calls are no-ops. */
export function injectWowheadTooltips(doc: Document = document): void {
    const already = Array.from(doc.scripts).some((s) => s.src === WOWHEAD_TOOLTIPS_SRC);
    if (already) return;
    const script = doc.createElement('script');
    script.src = WOWHEAD_TOOLTIPS_SRC;
    script.async = true;
    doc.head.appendChild(script);
}

injectWowheadTooltips();
