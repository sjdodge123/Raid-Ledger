/**
 * Token-level contrast check for a rendered colour scheme (ROK-1472).
 *
 * axe only measures text that happens to be on screen, so a token pair that no
 * scanned route renders (or renders only behind a hover) would never fail it.
 * This reads the scheme's resolved custom properties off <html> and asserts a
 * text token against each background token by WCAG 2.x contrast, so a scheme
 * whose `--color-dim` is too pale fails deterministically, whatever the seed.
 */
import type { Page } from '@playwright/test';
import { expect } from './base';

/** WCAG AA for normal-size text. */
export const AA_TEXT = 4.5;

/** Parse `#rgb`, `#rrggbb` or `rgb(r, g, b)` into 0-255 channels; null if unrecognised. */
export function parseColor(value: string): [number, number, number] | null {
    const v = value.trim().toLowerCase();
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
    if (short) return [short[1], short[2], short[3]].map((c) => parseInt(`${c}${c}`, 16)) as [number, number, number];
    const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(v);
    if (long) return [long[1], long[2], long[3]].map((c) => parseInt(c ?? '', 16)) as [number, number, number];
    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
    if (rgb) return [rgb[1], rgb[2], rgb[3]].map((c) => Number(c)) as [number, number, number];
    return null;
}

function luminance([r, g, b]: [number, number, number]): number {
    const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio of two colours, rounded to two decimals. */
export function contrastRatio(a: string, b: string): number {
    const ca = parseColor(a);
    const cb = parseColor(b);
    if (!ca || !cb) throw new Error(`unparseable colour: ${ca ? b : a}`);
    const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x) as [number, number];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** One line per background the text token falls short on; empty when every pair passes. */
export function tokenContrastFailures(
    tokens: Record<string, string>,
    text: string,
    backgrounds: string[],
    min = AA_TEXT,
): string[] {
    const fg = tokens[text] ?? '';
    return backgrounds.flatMap((bg) => {
        const bgValue = tokens[bg] ?? '';
        const ratio = contrastRatio(fg, bgValue);
        return ratio >= min ? [] : [`${text} ${fg} on ${bg} ${bgValue} = ${ratio}:1 (needs ${min}:1)`];
    });
}

/** Resolved values of `names` on <html>, as the page's active scheme sets them. */
export async function readSchemeTokens(page: Page, names: string[]): Promise<Record<string, string>> {
    return page.evaluate((props) => {
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p).trim()]));
    }, names);
}

/** Fail listing every background on which the `text` token misses `min`. */
export async function expectTokenContrast(
    page: Page,
    text: string,
    backgrounds: string[],
    min = AA_TEXT,
): Promise<void> {
    const tokens = await readSchemeTokens(page, [text, ...backgrounds]);
    const failures = tokenContrastFailures(tokens, text, backgrounds, min);
    expect(failures, failures.join('\n')).toEqual([]);
}
