/**
 * ROK-1655 / ROK-1472 — `Button brandColor` paints a runtime fill and marks the
 * button `data-brand-fill` + `data-brand-label="light|dark"` + `text-foreground`.
 * Operator ruling 2026-10-04 (ROK-1472): the label is whichever of white and
 * `#0f172a` has the higher WCAG contrast on the fill, on EVERY scheme. So the
 * light-scheme forced-white rule must NOT list `[data-brand-fill]` (it would
 * paint a white label on a light accent), and two unscoped rules map
 * `data-brand-label` to the colours `lib/brand-label.ts` chose between.
 *
 * CSS comments are stripped FIRST: the rules' own comments name these
 * selectors, and a guard that read comments would pass with them gone.
 */
import { describe, it, expect } from 'vitest';
import { defined } from '../test/defined';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { BRAND_LABEL_HEX } from '../lib/brand-label';

const LIGHT_SCHEMES = ['light', 'quest-log', 'sky', 'dawn', 'holy', 'celestial'];
const FORCED_WHITE = /--color-foreground:\s*#ffffff/i;
/** `:is(<schemes>) :is(<fills>).text-foreground` — the forced-white selector shape. */
const SELECTOR = /:is\(([^)]*)\)\s*:is\(([^)]*)\)\.text-foreground\s*$/;

const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

interface ForcedWhiteRule { schemes: string; fills: string[] }

/** Innermost rules whose selector has the forced-white shape and whose body sets foreground #fff. */
function forcedWhiteRules(css: string): ForcedWhiteRule[] {
    const rules: ForcedWhiteRule[] = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const shape = SELECTOR.exec(defined(selector, 'rule selector').trim());
        if (!shape || !FORCED_WHITE.test(defined(body, 'rule body'))) continue;
        rules.push({ schemes: defined(shape[1], 'scheme group'), fills: defined(shape[2], 'fill group').split(',').map((s) => s.trim()) });
    }
    return rules;
}

const css = stripCssComments(readFileSync(resolve(__dirname, '../index.css'), 'utf-8'));

describe('index.css forced-white rule — Button brandColor (ROK-1655)', () => {
    const rules = forcedWhiteRules(css);

    it('there is exactly one forced-white button-text rule', () => {
        expect(rules, 'expected one `:is(<schemes>) :is(<fills>).text-foreground { --color-foreground: #ffffff }` rule')
            .toHaveLength(1);
    });

    it('does NOT list [data-brand-fill] — a brand label is chosen by contrast, not forced white', () => {
        expect(rules[0]?.fills, 'a forced-white [data-brand-fill] paints white on a light accent (#10b981 → 2.5:1)')
            .not.toContain('[data-brand-fill]');
    });

    it('is scoped to all six light schemes', () => {
        for (const scheme of LIGHT_SCHEMES) {
            expect(rules[0]?.schemes, `the forced-white rule must cover data-scheme="${scheme}"`)
                .toContain(`[data-scheme="${scheme}"]`);
        }
    });
});

/** The body of the unlayered rule whose selector is exactly `selector`, or undefined. */
function ruleBody(src: string, selector: string): string | undefined {
    for (const [, sel, body] of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (defined(sel, 'selector').trim() === selector) return body;
    }
    return undefined;
}

describe('index.css brand label rules — every scheme (ROK-1472, ruling 2026-10-04)', () => {
    it.each(['light', 'dark'] as const)('data-brand-label="%s" paints the helper\'s colour, unscoped by scheme', (label) => {
        const body = ruleBody(css, `[data-brand-fill][data-brand-label="${label}"].text-foreground`);
        expect(body, `missing the unscoped [data-brand-label="${label}"] rule`).toBeDefined();
        const value = /--color-foreground:\s*(#[0-9a-f]{6})/i.exec(body ?? '')?.[1]?.toLowerCase();
        expect(value, `data-brand-label="${label}" must paint ${BRAND_LABEL_HEX[label]}`).toBe(BRAND_LABEL_HEX[label]);
    });
});
