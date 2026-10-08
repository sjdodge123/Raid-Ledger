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
import { readdirSync, readFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { stripComments as stripCodeComments } from '../test/form-primitives-count';
import { BRAND_LABEL_HEX } from '../lib/brand-label';
import { AA_SMALL_TEXT, contrastRatio } from './wcag-contrast';
import { lightSchemes } from './light-scheme-css';

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

const FORCED_DARK = /--color-foreground:\s*#0f172a/i;

/** Fill selectors of every `:is(<schemes>) :is(<fills>).text-foreground { --color-foreground: #0f172a }` rule, with its schemes. */
function forcedDarkRules(src: string): ForcedWhiteRule[] {
    const rules: ForcedWhiteRule[] = [];
    for (const [, selector, body] of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const shape = SELECTOR.exec(defined(selector, 'rule selector').trim());
        if (!shape || !FORCED_DARK.test(defined(body, 'rule body'))) continue;
        rules.push({ schemes: defined(shape[1], 'scheme group'), fills: defined(shape[2], 'fill group').split(',').map((s) => s.trim()) });
    }
    return rules;
}

describe('index.css forced-dark label — fills white cannot clear (ROK-1472)', () => {
    // cyan-600 #0092b8: white 3.62:1, dawn's own foreground #2D1F0F 4.42:1, #0f172a 4.93:1.
    const rule = forcedDarkRules(css).find((r) => r.fills.includes('.bg-cyan-600'));

    it('forces #0f172a on a .bg-cyan-600 text-foreground label', () => {
        expect(rule, 'no light-family rule paints #0f172a on .bg-cyan-600.text-foreground (dawn falls to 4.42:1)').toBeDefined();
    });

    it('covers all six light schemes', () => {
        for (const scheme of LIGHT_SCHEMES) {
            expect(rule?.schemes ?? '', `the cyan-600 dark-label rule must cover data-scheme="${scheme}"`)
                .toContain(`[data-scheme="${scheme}"]`);
        }
    });

    it('also forces #0f172a on a solid .bg-cyan-500 label (YouOwnBadge: white 2.37:1, #0f172a 7.55:1)', () => {
        expect(rule?.fills, 'the dark-label rule must list .bg-cyan-500').toContain('.bg-cyan-500');
    });

    it('cyan-600 is not also in the forced-white list (white is 3.62:1 on it)', () => {
        expect(forcedWhiteRules(css)[0]?.fills).not.toContain('.bg-cyan-600');
    });
});

const SRC = resolve(__dirname, '..');

/*
 * Mid-tone fills a white label cannot clear on the light schemes, and nothing in
 * index.css repaints them there: cyan-600 #0092b8 (white 3.62:1), emerald-500
 * #10b981 (2.53:1; at /90 over a light card #18c289, 2.3:1 — the /games "Best
 * Price" chip), cyan-500 #00b8db (2.37:1; at /90, 2.34:1 — the "You own" chip)
 * and amber-500 #f59e0b (2.15:1). A solid status fill is `bg-success` /
 * `bg-warning` + `text-white`: white on light (#065f46 7.68:1, #92400e 7.09:1), and
 * the #0f172a --color-status-solid-label on the dark family, where white is 2.54 / 2.15:1
 * on #10b981 / #f59e0b (TDB:2052 — the status-label rule asserted below);
 * a cyan-500 / cyan-600 label is `text-foreground` (the #0f172a rule above).
 */
const WHITE_UNSAFE_FILL = /(^|\s)bg-(cyan-600|cyan-500(\/\d+)?|emerald-500(\/\d+)?|amber-500(\/\d+)?)(\s|$)/;

/** `file:line` of every class string that pairs a white-unsafe fill with a raw `text-white` label. */
function whiteOnMidFillLabels(): string[] {
    const files = (readdirSync(SRC, { recursive: true }) as string[])
        .map((f) => f.split(sep).join('/'))
        .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f));
    return files.sort().flatMap((f) => {
        const code = stripCodeComments(readFileSync(join(SRC, f), 'utf-8'));
        return [...code.matchAll(/(['"`])([^'"`]*)\1/g)]
            .filter(([, , cls]) => WHITE_UNSAFE_FILL.test(cls ?? '') && /(^|\s)text-white(\s|$)/.test(cls ?? ''))
            .map((m) => `${f}:${code.slice(0, m.index).split('\n').length}`);
    });
}

describe('mid-tone fills never carry a text-white label (ROK-1472)', () => {
    it('no class string in web/src pairs bg-cyan-600 / bg-cyan-500 / bg-emerald-500 / bg-amber-500 with text-white', () => {
        expect(whiteOnMidFillLabels(), 'white is 2.2–3.6:1 on these fills on the light schemes — use bg-success / bg-warning (white on light, --color-status-solid-label #0f172a on dark), or text-foreground on cyan-600')
            .toEqual([]);
    });
});

/** `:is(<fills>).text-white` — the status-label selector shape (TDB:2052). */
const STATUS_LABEL = /^:is\(([^)]*)\)\.text-white$/;
const STATUS_FILLS = ['success', 'warning', 'danger'] as const;

/** Every depth-0 (unlayered, unscoped by any at-rule) rule as `[selector, body]`. */
function topLevelRules(src: string): Array<[string, string]> {
    const rules: Array<[string, string]> = [];
    let depth = 0;
    let selStart = 0;
    let open = 0;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (ch === ';' && depth === 0) selStart = i + 1;
        else if (ch === '{' && depth++ === 0) open = i;
        else if (ch === '}' && --depth === 0) {
            rules.push([src.slice(selStart, open).trim(), src.slice(open + 1, i)]);
            selStart = i + 1;
        }
    }
    return rules;
}

const TOP = topLevelRules(css);

/** `--color-<name>` declared directly in a block body, lower-cased, or undefined. */
const declaredIn = (body: string, name: string): string | undefined =>
    new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(body)?.[1]?.toLowerCase();

const THEME = TOP.find(([sel]) => sel === '@theme')?.[1] ?? '';
const SHARED_LIGHT = TOP.find(([sel, body]) => /^:is\(\[data-scheme="light"\][^)]*\)$/.test(sel) && /--color-surface:/.test(body))?.[1] ?? '';
const LIGHT_NAMES = lightSchemes(css).map(({ name }) => name);
const DARK_NAMES = TOP.flatMap(([sel]) => /^\[data-scheme="([a-z-]+)"\]$/.exec(sel)?.[1] ?? []).filter((n) => !LIGHT_NAMES.includes(n));

/** The blocks a scheme resolves a token through, nearest first: own block(s), shared light block, `@theme`. */
function chain(scheme: string): string[] {
    const own = TOP.filter(([sel]) => sel === `[data-scheme="${scheme}"]` || sel === `[data-variant="${scheme}"]`).map(([, body]) => body);
    return LIGHT_NAMES.includes(scheme) ? [...own, SHARED_LIGHT, THEME] : [...own, THEME];
}

const resolve1 = (scheme: string, name: string): string =>
    defined(chain(scheme).map((body) => declaredIn(body, name)).find((v) => v !== undefined), `${scheme} --color-${name}`);

/** [scheme, fill token, label hex, fill hex] for every scheme × solid status fill. */
const LABEL_ON_FILL = ['default-dark', ...DARK_NAMES, ...LIGHT_NAMES].flatMap((scheme) =>
    STATUS_FILLS.map((token) => [scheme, token, resolve1(scheme, 'status-solid-label'), resolve1(scheme, token)] as const),
);

describe('index.css status-solid label on solid success / warning / danger (TDB:2052, ruling 2026-10-08)', () => {
    const rule = TOP.find(([sel]) => STATUS_LABEL.test(sel) && sel.includes('.bg-success'));

    it('paints var(--color-status-solid-label) on .bg-success / .bg-warning / .bg-danger + text-white, unlayered and unscoped', () => {
        expect(rule, 'no top-level `:is(.bg-success, …).text-white { color: var(--color-status-solid-label) }` rule — white is 2.54:1 on dark #10b981 (inside @layer it would lose to the text-white utility)').toBeDefined();
        const fills = defined(STATUS_LABEL.exec(rule?.[0] ?? '')?.[1] ?? '', 'fill group').split(',').map((f) => f.trim());
        for (const token of STATUS_FILLS) expect(fills, `the status-label rule must list .bg-${token}`).toContain(`.bg-${token}`);
        expect(rule?.[1] ?? '', 'the rule must paint the scheme-scoped token, not a hex keyed off <html>').toMatch(/(?:^|[;\s])color:\s*var\(--color-status-solid-label\)/);
    });

    it('declares the label in both families: #0f172a in @theme, #ffffff in the shared light block', () => {
        expect(declaredIn(THEME, 'status-solid-label'), 'dark default (@theme) --color-status-solid-label').toBe('#0f172a');
        expect(declaredIn(SHARED_LIGHT, 'status-solid-label'), 'shared light :is([data-scheme="light"]…) --color-status-solid-label').toBe('#ffffff');
    });

    it('resolves every dark scheme and all six light schemes', () => {
        expect(new Set(LABEL_ON_FILL.map(([scheme]) => scheme))).toEqual(new Set(['default-dark', ...DARK_NAMES, ...LIGHT_NAMES]));
        expect(LIGHT_NAMES, 'light schemes read from index.css').toEqual(expect.arrayContaining(['light', 'quest-log', 'sky', 'dawn', 'holy', 'celestial']));
        expect(DARK_NAMES.length, 'dark [data-scheme] blocks read from index.css').toBeGreaterThanOrEqual(8);
    });

    it('a dark scheme that repaints a status fill declares its own label (a nested light column would otherwise pair it with white)', () => {
        for (const scheme of DARK_NAMES) {
            const own = TOP.filter(([sel]) => sel === `[data-scheme="${scheme}"]`).map(([, body]) => body).join('\n');
            const repaints = STATUS_FILLS.some((token) => declaredIn(own, token) !== undefined);
            if (repaints) expect(declaredIn(own, 'status-solid-label'), `${scheme} repaints a status fill without its own --color-status-solid-label`).toBeDefined();
        }
    });

    it.each(LABEL_ON_FILL)('%s: the status label clears AA on solid bg-%s', (scheme, token, label, fill) => {
        const ratio = contrastRatio(label, fill);
        expect(ratio, `${scheme}: --color-status-solid-label ${label} is ${ratio}:1 on bg-${token} ${fill} — needs ${AA_SMALL_TEXT}:1`)
            .toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});
