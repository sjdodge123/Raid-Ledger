/**
 * ROK-1472 (operator ruling 2026-10-04) — on the six light schemes the solid
 * primary fill `.bg-emerald-600` is repainted emerald-700 (`#047857`, the light
 * `--color-success`) so its forced-white label is AA, and its hover goes DARKER
 * (emerald-800) instead of the lighter `hover:bg-emerald-500` (~2.5:1). The
 * hover rule is scoped to elements that ALSO carry `.bg-emerald-600`, so other
 * `hover:bg-emerald-500` uses keep their paint. Dark schemes are untouched.
 *
 * Comments are stripped first so a rule's own comment cannot satisfy the guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AA_SMALL_TEXT, contrastRatio, luminance, stripComments } from './wcag-contrast';

const LIGHT = ['light', 'quest-log', 'sky', 'dawn', 'holy', 'celestial'].map((s) => `[data-scheme="${s}"]`).join(',');
const SCOPE = `:is(${LIGHT})`;
const css = stripComments(readFileSync(resolve(__dirname, '../index.css'), 'utf-8'));

/** The `background-color` hex of the rule whose selector is exactly `selector`. */
function fillOf(selector: string): string | undefined {
    for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (sel?.trim() !== selector) continue;
        return /background-color:\s*(#[0-9a-f]{6})/i.exec(body ?? '')?.[1]?.toLowerCase();
    }
    return undefined;
}

const BASE = `${SCOPE} .bg-emerald-600`;
const HOVER = `${SCOPE} .bg-emerald-600:is(.hover\\:bg-emerald-500, .hover\\:bg-emerald-700):hover`;

describe('primary fill on the light schemes (ROK-1472)', () => {
    it('repaints .bg-emerald-600 emerald-700, AA with the forced-white label', () => {
        const fill = fillOf(BASE);
        expect(fill, `missing \`${BASE} { background-color }\``).toBe('#047857');
        expect(contrastRatio(fill ?? '#ffffff', '#ffffff'), 'white on the light primary fill').toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    it('its hover goes darker than the fill and stays AA, scoped to .bg-emerald-600', () => {
        const hover = fillOf(HOVER);
        expect(hover, `missing the scoped hover rule \`${HOVER}\``).toBe('#065f46');
        expect(luminance(hover ?? '#ffffff'), 'the light hover must be darker than the fill').toBeLessThan(luminance('#047857'));
        expect(contrastRatio(hover ?? '#ffffff', '#ffffff'), 'white on the light primary hover').toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    it('never repaints a bare hover:bg-emerald-500 on light', () => {
        const bare = /^:is\([^)]*\)\s*\.hover\\:bg-emerald-500:hover$/;
        const sels = [...css.matchAll(/([^{}]+)\{/g)].map(([, s]) => (s ?? '').trim());
        expect(sels.filter((s) => bare.test(s)), 'an unscoped light hover:bg-emerald-500 rule repaints every use').toEqual([]);
    });
});
