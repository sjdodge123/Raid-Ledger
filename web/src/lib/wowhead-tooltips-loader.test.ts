import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * ROK-1366: tooltips.js is injected from the entry (not index.html) as an
 * async script, after the magic-link fragment strip.
 */
const TOOLTIPS_SRC = 'https://wow.zamimg.com/js/tooltips.js';

const tooltipScripts = (): HTMLScriptElement[] =>
    Array.from(document.scripts).filter((s) => s.src === TOOLTIPS_SRC);

describe('ROK-1366: wowhead-tooltips-loader', () => {
    beforeEach(() => {
        vi.resetModules();
        tooltipScripts().forEach((s) => s.remove());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        tooltipScripts().forEach((s) => s.remove());
    });

    it('appends one async (not deferred) tooltips.js script to <head> at import', async () => {
        await import('./wowhead-tooltips-loader');
        const found = tooltipScripts().map((s) => ({ parent: s.parentElement?.tagName, async: s.async, defer: s.defer }));
        expect(found).toEqual([{ parent: 'HEAD', async: true, defer: false }]);
    });

    it('does not inject a second copy when called again', async () => {
        const mod = await import('./wowhead-tooltips-loader');
        mod.injectWowheadTooltips();
        mod.injectWowheadTooltips();
        expect(tooltipScripts()).toHaveLength(1);
    });

    it('requests tooltips.js only once the #token= fragment is already stripped (main.tsx order)', async () => {
        window.history.replaceState(null, '', '/events/42#token=abc.def');
        const hashWhenInjected: string[] = [];
        const append = document.head.appendChild.bind(document.head);
        vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
            if (node instanceof HTMLScriptElement && node.src === TOOLTIPS_SRC) hashWhenInjected.push(window.location.hash);
            return append(node);
        });
        await import('./magic-link-capture');
        await import('./wowhead-tooltips-loader');
        expect(hashWhenInjected, 'tooltips.js must be requested with the token already gone').toEqual(['']);
    });
});
