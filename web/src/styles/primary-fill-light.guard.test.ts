/**
 * ROK-1472 (operator ruling 2026-10-04) — on the six light schemes the solid
 * primary fill `.bg-emerald-600` is repainted emerald-700 (`#047857`, the light
 * `--color-success`) so its forced-white label is AA, and its hover goes DARKER
 * (emerald-800) instead of the lighter `hover:bg-emerald-500` (~2.5:1). The
 * hover rule is scoped to elements that ALSO carry `.bg-emerald-600`, so other
 * `hover:bg-emerald-500` uses keep their paint. Dark schemes are untouched.
 * Both rules are unlayered, so they beat every Tailwind v4 `@layer utilities`
 * variant: each must skip a disabled / aria-disabled element that carries its
 * own `disabled:bg-*` / `aria-disabled:bg-*` paint, or that button paints
 * enabled-green. An opacity-only disabled or loading primary (Button `loading`
 * sets aria-disabled) must KEEP the scheme fill. The same holds for quest-log's
 * `!important` gold rules, so the guard covers every scheme's solid primary fill.
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

const ENABLED = ':not(:disabled[class*="disabled:bg-"], [aria-disabled="true"][class*="aria-disabled:bg-"])';
const BASE = `${SCOPE} .bg-emerald-600${ENABLED}`;
const HOVER = `${SCOPE} .bg-emerald-600:is(.hover\\:bg-emerald-500, .hover\\:bg-emerald-700)${ENABLED}:hover`;

/** Selectors of rules, in ANY scheme, that paint a background onto solid `.bg-emerald-600` (not its `/NN` tints, not `:not(.bg-emerald-600)`). */
function primaryFillSelectors(): string[] {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, sel, body]) => [(sel ?? '').trim(), body ?? ''] as const)
        .filter(([sel, body]) => /(?<!:not\()\.bg-emerald-600(?!\\)/.test(sel) && /(^|[;\s])background(-color)?:/.test(body))
        .map(([sel]) => sel);
}

/** Selectors of the single rules wrapped in `@media (hover: hover) { … }`. */
const HOVER_GATED = [...css.matchAll(/@media\s*\(hover:\s*hover\)\s*\{([^{}]+)\{[^{}]*\}\s*\}/g)].map(([, sel]) => (sel ?? '').trim());

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

    it('no scheme paints a solid primary fill over a disabled or aria-disabled button', () => {
        const sels = primaryFillSelectors();
        expect(sels, 'expected the light fill + hover and the quest-log gold rules').toEqual(expect.arrayContaining([BASE, HOVER]));
        expect(sels.length, 'quest-log gold fill rules not found').toBeGreaterThanOrEqual(5);
        const leaky = sels.filter((s) => !s.includes(ENABLED));
        expect(leaky, `.bg-emerald-600 fill rules (unlayered or !important) must end in \`${ENABLED}\``).toEqual([]);
    });

    it.each([
        ['a native-disabled primary with disabled:bg-* gets its own disabled paint', { disabled: true, cls: 'disabled:bg-overlay' }, false],
        ['an aria-disabled primary with aria-disabled:bg-* gets its own disabled paint', { aria: true, cls: 'aria-disabled:bg-overlay' }, false],
        ['a loading primary (aria-disabled, opacity-only) keeps the scheme fill', { aria: true, cls: 'disabled:opacity-50' }, true],
        ['a native-disabled opacity-only primary keeps the scheme fill', { disabled: true, cls: 'disabled:opacity-50' }, true],
        ['an enabled primary keeps the scheme fill', { cls: 'disabled:bg-overlay' }, true],
    ] as const)('every scheme fill rule: %s', (_, state, keeps) => {
        const host = document.createElement('div');
        host.innerHTML = '<div data-scheme="light" data-variant="quest-log"><button></button></div>';
        const button = host.querySelector('button') as HTMLButtonElement;
        button.className = `bg-emerald-600 hover:bg-emerald-500 ${state.cls}`;
        if ('disabled' in state) button.disabled = true;
        if ('aria' in state) button.setAttribute('aria-disabled', 'true');
        for (const sel of primaryFillSelectors()) {
            expect(button.matches(sel.replace(/:(hover|active)$/, '')), `${sel} on ${button.outerHTML}`).toBe(keeps);
        }
    });

    it('gates every primary-fill hover rule behind @media (hover: hover), like Tailwind v4 hover:', () => {
        const hovers = primaryFillSelectors().filter((s) => s.endsWith(':hover'));
        expect(hovers, `\`${HOVER}\` is a primary-fill hover rule`).toContain(HOVER);
        expect(hovers.filter((s) => !HOVER_GATED.includes(s)), 'hover fill rules outside @media (hover: hover)').toEqual([]);
    });

    it('never repaints a bare hover:bg-emerald-500 on light', () => {
        const bare = /^:is\([^)]*\)\s*\.hover\\:bg-emerald-500:hover$/;
        const sels = [...css.matchAll(/([^{}]+)\{/g)].map(([, s]) => (s ?? '').trim());
        expect(sels.filter((s) => bare.test(s)), 'an unscoped light hover:bg-emerald-500 rule repaints every use').toEqual([]);
    });
});
