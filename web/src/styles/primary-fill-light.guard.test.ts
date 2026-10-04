/**
 * ROK-1472 (operator ruling 2026-10-04) — on the six light schemes the solid
 * primary fill `.bg-emerald-600` is repainted emerald-700 (`#047857`, the light
 * `--color-success`) so its forced-white label is AA, and its hover goes DARKER
 * (emerald-800) instead of the lighter `hover:bg-emerald-500` (~2.5:1). The
 * hover rule is scoped to elements that ALSO carry `.bg-emerald-600`, so other
 * `hover:bg-emerald-500` uses keep their paint. Dark schemes are untouched.
 * Both rules are unlayered, so they beat every Tailwind v4 `@layer utilities`
 * variant: each must skip `:disabled` and `[aria-disabled="true"]`, or a
 * disabled primary button paints enabled-green over its `disabled:bg-*`.
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

const ENABLED = ':not(:disabled):not([aria-disabled="true"])';
const BASE = `${SCOPE} .bg-emerald-600${ENABLED}`;
const HOVER = `${SCOPE} .bg-emerald-600:is(.hover\\:bg-emerald-500, .hover\\:bg-emerald-700)${ENABLED}:hover`;

/** Selectors of light-scope rules that paint a background onto solid `.bg-emerald-600` (not its `/NN` tints). */
function lightPrimaryFillSelectors(): string[] {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, sel, body]) => [(sel ?? '').trim(), body ?? ''] as const)
        .filter(([sel, body]) => sel.startsWith(SCOPE) && /\.bg-emerald-600(?!\\)/.test(sel) && /background(-color)?:/.test(body))
        .map(([sel]) => sel);
}

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

    it('never paints over a disabled or aria-disabled button (its disabled: variant must win)', () => {
        const sels = lightPrimaryFillSelectors();
        expect(sels.length, 'no light .bg-emerald-600 fill rules found').toBeGreaterThanOrEqual(2);
        const leaky = sels.filter((s) => !s.includes(':not(:disabled)') || !s.includes(':not([aria-disabled="true"])'));
        expect(leaky, 'unlayered light .bg-emerald-600 rules must skip :disabled and [aria-disabled="true"]').toEqual([]);
    });

    it('gates the hover rule behind @media (hover: hover), like Tailwind v4 hover:', () => {
        const media = /@media\s*\(hover:\s*hover\)\s*\{([^{}]+)\{[^{}]*\}\s*\}/g;
        const gated = [...css.matchAll(media)].map(([, sel]) => (sel ?? '').trim());
        expect(gated, `\`${HOVER}\` must sit inside @media (hover: hover)`).toContain(HOVER);
    });

    it('never repaints a bare hover:bg-emerald-500 on light', () => {
        const bare = /^:is\([^)]*\)\s*\.hover\\:bg-emerald-500:hover$/;
        const sels = [...css.matchAll(/([^{}]+)\{/g)].map(([, s]) => (s ?? '').trim());
        expect(sels.filter((s) => bare.test(s)), 'an unscoped light hover:bg-emerald-500 rule repaints every use').toEqual([]);
    });
});
