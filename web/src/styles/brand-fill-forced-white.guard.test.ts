/**
 * ROK-1655 — `Button brandColor` paints a runtime fill and marks the button
 * `data-brand-fill` + `text-foreground`. On the six light schemes the label is
 * only white because index.css's forced-white rule lists `[data-brand-fill]`
 * among its fills; drop it and the label goes near-black on a saturated brand
 * colour. This pins the selector inside that rule's fill list.
 *
 * CSS comments are stripped FIRST: the rule's own comment names
 * `[data-brand-fill]`, and a guard that read comments would pass with the
 * selector gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
        const shape = SELECTOR.exec(selector.trim());
        if (!shape || !FORCED_WHITE.test(body)) continue;
        rules.push({ schemes: shape[1], fills: shape[2].split(',').map((s) => s.trim()) });
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

    it('lists [data-brand-fill] among its fills', () => {
        expect(rules[0]?.fills, 'the forced-white rule must list [data-brand-fill], or a brandColor label is dark on light schemes')
            .toContain('[data-brand-fill]');
    });

    it('is scoped to all six light schemes', () => {
        for (const scheme of LIGHT_SCHEMES) {
            expect(rules[0]?.schemes, `the forced-white rule must cover data-scheme="${scheme}"`)
                .toContain(`[data-scheme="${scheme}"]`);
        }
    });
});
