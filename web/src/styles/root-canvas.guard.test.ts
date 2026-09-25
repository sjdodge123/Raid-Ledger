import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripComments } from './wcag-contrast';

/**
 * Root-canvas guard (ROK-1661, iPad plan 2026-09-23-2034-11b7 steps 2-4).
 *
 * iPad Safari lets a page scroll or pan past the document's end and fills that
 * area with one flat colour that WebKit takes from html's background-color with
 * body's blended over it (images are ignored). A strip of page background showed
 * there under the footer. The canvas must be the footer's --color-surface, and
 * no body rule may set a colour of its own, or it wins; the Layout shell is the
 * only painter of --color-backdrop. A chromeless /p/* page has no footer and
 * ends on --color-backdrop, so its canvas (html[data-chromeless], set by
 * Layout) stays backdrop.
 */

const SRC_ROOT = resolve(__dirname, '..');

interface CssRule { file: string; selector: string; body: string }

function rulesOf(file: string): CssRule[] {
    const css = stripComments(readFileSync(join(SRC_ROOT, file), 'utf-8'));
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
        file, selector: selector.trim(), body,
    }));
}

const cssFiles = (readdirSync(SRC_ROOT, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.css'));

const sets = (body: string, prop: string) => new RegExp(`(^|[;\\s])${prop}\\s*:`).test(body);

describe('Regression: ROK-1661 — the area past the document end reads as footer', () => {
    it('paints the root canvas (html) in --color-surface', () => {
        const htmlRules = rulesOf('index.css').filter((r) => r.selector === 'html');
        expect(htmlRules.some((r) => /background-color\s*:\s*var\(--color-surface\)/.test(r.body))).toBe(true);
    });

    it('keeps the canvas --color-backdrop on a chromeless /p/* page, which ends on backdrop with no footer', () => {
        const rules = rulesOf('index.css').filter((r) => r.selector === 'html[data-chromeless]');
        expect(rules.some((r) => /background-color\s*:\s*var\(--color-backdrop\)/.test(r.body))).toBe(true);
    });

    it('leaves every body rule without a background colour', () => {
        const endsInBody = (selector: string) =>
            selector.split(',').some((part) => /(^|[\s>+~])body$/.test(part.trim()));
        const offenders = cssFiles.flatMap(rulesOf)
            .filter((r) => endsInBody(r.selector))
            .filter((r) => sets(r.body, 'background-color') || sets(r.body, 'background'))
            .map((r) => `${r.file}: ${r.selector}`);
        expect(offenders).toEqual([]);
    });
});
