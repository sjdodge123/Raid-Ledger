import { describe, it, expect } from 'vitest';
import { defined } from '../test/defined';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AA_SMALL_TEXT, composite, contrastRatio, stripComments } from './wcag-contrast';
import { lightSchemes } from './light-scheme-css';

/**
 * Semantic colour-token guard (ROK-1586 slice 2).
 *
 * `--color-success` / `--color-warning` / `--color-danger` carry MEANING, not a hue,
 * so a scheme can repaint the meaning. A token that is referenced by a utility class
 * but never declared renders as nothing — the failure mode `design-system.md` §6.3
 * describes for `--color-accent`. This guard makes that impossible for the semantic
 * set: every token must be declared in BOTH the `@theme` block (dark defaults) and
 * the shared light `:is(...)` block, exactly the way `--color-busy` already is.
 *
 * Comments are stripped FIRST so this file's own prose — and the explanatory comment
 * that follows each declaration in `index.css` — can never satisfy or trip the check.
 */

const cssPath = resolve(__dirname, '../index.css');

const css = stripComments(readFileSync(cssPath, 'utf-8'));

/**
 * Extract a brace-balanced block whose opening line matches `startPattern`.
 *
 * @param source - comment-stripped CSS
 * @param startPattern - matches the selector/at-rule that opens the block
 * @returns the block body, or an empty string when the selector is absent
 */
function extractBlock(source: string, startPattern: RegExp): string {
    const match = startPattern.exec(source);
    if (match === null) return '';
    const open = source.indexOf('{', match.index);
    if (open === -1) return '';
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    return '';
}

/**
 * Read a custom-property value out of a CSS block.
 *
 * @returns the declared value, or `null` when the property is not declared there
 */
function declaredValue(block: string, token: string): string | null {
    const match = new RegExp(`--color-${token}\\s*:\\s*([^;]+);`).exec(block);
    return match === null ? null : defined(match[1], 'declared value').trim();
}

const themeBlock = extractBlock(css, /@theme\s*\{/);
const lightBlock = extractBlock(css, /:is\(\[data-scheme="light"\][^)]*\)\s*\{/);

/** Semantic roles plus `--color-busy`, the shipped token whose 2-block shape they copy. */
const SEMANTIC_TOKENS = ['success', 'warning', 'danger', 'busy'] as const;

/** `--color-surface` of the shared light block — what light-family text sits on. */
const LIGHT_SURFACE = '#ffffff';

/**
 * Every background a light semantic token is really read on (ROK-1586 fleet plan
 * 2026-09-22-2005-3f02 step 2: "amber and red are hard to read on light"). Measuring
 * only against `#fff` let danger ship at 4.41:1 on the panel and 3.79:1 on its own tint.
 */
function lightBackgrounds(token: string): Array<[string, string]> {
    const shared = (name: string) => declaredValue(lightBlock, name) as string;
    return [
        ['--color-surface', shared('surface')],
        ['--color-backdrop', shared('backdrop')],
        ['--color-panel', shared('panel')],
        ['JourneyHero card (bg-overlay/40 over backdrop)', composite(shared('overlay'), shared('backdrop'), 0.4)],
        [`bg-${token}/10 tint over --color-panel`, composite(shared(token), shared('panel'), 0.1)],
    ];
}

/** Roles measured on every real background of the shared light block. */
const SEMANTIC_ROLES = ['success', 'warning', 'danger'] as const;

/**
 * TDB:1793 (ruling D:1714): light success is #065f46 so it clears AA as text on every
 * light scheme's OWN surface, panel and /10 tint over that panel — no per-scheme override.
 * #047857 was 4.38 on the shared tint and 4.06 / 3.59 on celestial's panel / tint.
 */
const SUCCESS_ON_SCHEMES = lightSchemes(css).flatMap(({ name, surface, panel }) => {
    const success = declaredValue(lightBlock, 'success') as string;
    return [
        [name, 'surface', surface],
        [name, 'panel', panel],
        [name, 'bg-success/10 tint over its panel', composite(success, panel, 0.1)],
    ] as const;
});

/** Light-family scheme names — every other `[data-scheme]` block is a dark scheme. */
const LIGHT_NAMES = new Set(lightSchemes(css).map(({ name }) => name));

/**
 * TDB:1770 ruling 2026-10-08: dark semantic text must clear AA on every dark scheme's
 * surface, panel and the token's own /10 tint over that panel. Dark `--color-danger`
 * red-500 #ef4444 was 3.89:1 on the default-dark panel, so it is red-400 #f87171.
 * A dark scheme block that declares its own token value is measured with that value.
 */
function darkTextRows(): Array<readonly [string, string, string, string]> {
    const schemes: Array<[string, string]> = [['default-dark', themeBlock]];
    for (const [, name, body] of css.matchAll(/(?:^|\n)\[data-scheme="([a-z-]+)"\]\s*\{([^}]*)\}/g)) {
        if (!LIGHT_NAMES.has(defined(name, 'scheme name'))) schemes.push([name as string, defined(body, 'scheme body')]);
    }
    return schemes.flatMap(([name, body]) => SEMANTIC_ROLES.flatMap((token) => {
        const value = declaredValue(body, token) ?? (declaredValue(themeBlock, token) as string);
        const panel = declaredValue(body, 'panel');
        const surface = declaredValue(body, 'surface');
        if (panel === null || surface === null) return [];
        const row = (label: string, bg: string) => [token, name, label, `${value}|${bg}`] as const;
        return [row('surface', surface), row('panel', panel), row(`bg-${token}/10 tint over its panel`, composite(value, panel, 0.1))];
    }));
}

const DARK_TEXT = darkTextRows();

const TEXT_ON_BACKGROUND = SEMANTIC_ROLES.flatMap((token) =>
    lightBackgrounds(token).map(([name, bg]) => [token, name, bg] as const),
);

describe('semantic colour tokens (ROK-1586)', () => {
    it('finds both token blocks in index.css', () => {
        expect(themeBlock, 'the @theme block was not found in index.css').not.toBe('');
        expect(lightBlock, 'the shared light :is([data-scheme="light"]…) block was not found in index.css').not.toBe('');
    });

    it.each(SEMANTIC_TOKENS)('--color-%s is declared in the @theme block (dark default)', (token) => {
        const value = declaredValue(themeBlock, token);
        expect(
            value,
            `--color-${token} is referenced by Tailwind utilities but is NOT declared in the @theme block of index.css`,
        ).not.toBeNull();
        expect(value, `--color-${token} in @theme must be a hex colour`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    });

    it.each(SEMANTIC_TOKENS)('--color-%s is overridden in the shared light block', (token) => {
        const value = declaredValue(lightBlock, token);
        expect(
            value,
            `--color-${token} has no light-family override in the shared :is([data-scheme="light"]…) block of index.css — light schemes would inherit the dark value`,
        ).not.toBeNull();
        expect(value, `--color-${token} in the light block must be a hex colour`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    });

    it.each(SEMANTIC_TOKENS)('--color-%s uses a contrast-corrected value on light, not the dark one', (token) => {
        expect(
            declaredValue(lightBlock, token),
            `--color-${token} repeats its dark value in the light block — the override buys nothing`,
        ).not.toBe(declaredValue(themeBlock, token));
    });

    it.each(SEMANTIC_TOKENS)('--color-%s clears WCAG AA for small text on the light surface', (token) => {
        const value = declaredValue(lightBlock, token);
        expect(value, `--color-${token} has no light-family override to measure`).not.toBeNull();
        const ratio = contrastRatio(value as string, LIGHT_SURFACE);
        expect(
            ratio,
            `--color-${token} light value ${value} is ${ratio}:1 on ${LIGHT_SURFACE} — small text (the 10px "Suggested" label, the hero badges) needs ${AA_SMALL_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    it.each(TEXT_ON_BACKGROUND)('light text-%s clears AA on %s', (token, name, bg) => {
        const value = declaredValue(lightBlock, token) as string;
        const ratio = contrastRatio(value, bg);
        expect(
            ratio,
            `light --color-${token} ${value} as text is ${ratio}:1 on ${name} (${bg}) — needs ${AA_SMALL_TEXT}:1`,
        ).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });

    it.each(SEMANTIC_ROLES)('white text on a solid light bg-%s clears AA', (token) => {
        const value = declaredValue(lightBlock, token) as string;
        const ratio = contrastRatio('#ffffff', value);
        expect(ratio, `white text on light bg-${token} ${value} is ${ratio}:1 — needs ${AA_SMALL_TEXT}:1`).toBeGreaterThanOrEqual(
            AA_SMALL_TEXT,
        );
    });
});

describe('light --color-success on every light scheme (TDB:1793)', () => {
    it('reads all six light schemes out of index.css', () => {
        expect(SUCCESS_ON_SCHEMES.map(([name]) => name)).toEqual(
            expect.arrayContaining(['light', 'quest-log', 'sky', 'dawn', 'holy', 'celestial']),
        );
        for (const [name, bg, hex] of SUCCESS_ON_SCHEMES) expect(hex, `${name} has no resolved ${bg}`).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it.each(SUCCESS_ON_SCHEMES)('light text-success clears AA on %s %s', (name, bg, hex) => {
        const value = declaredValue(lightBlock, 'success') as string;
        const ratio = contrastRatio(value, hex);
        expect(ratio, `light --color-success ${value} as text is ${ratio}:1 on ${name} ${bg} (${hex}) — needs ${AA_SMALL_TEXT}:1`)
            .toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});

describe('dark semantic text on every dark scheme (TDB:1770 ruling 2026-10-08)', () => {
    it('reads default-dark and the eight dark schemes out of index.css', () => {
        expect(new Set(DARK_TEXT.map(([, name]) => name))).toEqual(
            new Set(['default-dark', 'space', 'underwater', 'obsidian', 'ember', 'arctic', 'bloodmoon', 'forest', 'fel']),
        );
    });

    it.each(DARK_TEXT)('dark text-%s clears AA on %s %s', (token, name, bgLabel, pair) => {
        const [fg, bg] = pair.split('|') as [string, string];
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `dark --color-${token} ${fg} as text is ${ratio}:1 on ${name} ${bgLabel} (${bg}) — needs ${AA_SMALL_TEXT}:1`)
            .toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    });
});
