import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

/** Strip CSS block comments so only real declarations are inspected. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

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
    return match === null ? null : match[1].trim();
}

/**
 * Relative luminance of an sRGB hex colour (WCAG 2.x definition).
 *
 * @param hex - `#rrggbb`
 * @returns luminance in `[0, 1]`
 */
function luminance(hex: string): number {
    const digits = hex.replace('#', '');
    const channels = [0, 2, 4]
        .map((i) => parseInt(digits.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * WCAG contrast ratio between two sRGB hex colours.
 *
 * @returns a ratio in `[1, 21]`, rounded to two decimals
 */
function contrastRatio(a: string, b: string): number {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

const themeBlock = extractBlock(css, /@theme\s*\{/);
const lightBlock = extractBlock(css, /:is\(\[data-scheme="light"\][^)]*\)\s*\{/);

/** Semantic roles plus `--color-busy`, the shipped token whose 2-block shape they copy. */
const SEMANTIC_TOKENS = ['success', 'warning', 'danger', 'busy'] as const;

/** `--color-surface` of the shared light block — what light-family text sits on. */
const LIGHT_SURFACE = '#ffffff';

/** WCAG 2.1 AA minimum for text below 18.66px/bold-14px. */
const AA_SMALL_TEXT = 4.5;

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
});
