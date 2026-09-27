import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ROK-1366 review fix: the fragment token must be gone from the address bar
 * BEFORE Sentry initialises (Sentry hooks history for breadcrumbs, tracing
 * and replay). main.tsx therefore imports magic-link-capture first.
 */
const here = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /^import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm;

function importsOf(file: string): string[] {
    const src = readFileSync(join(here, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    return [...src.matchAll(IMPORT_RE)].map((m) => m[1]);
}

describe('ROK-1366: magic-link fragment is captured before Sentry initialises', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('strips #token= from the address bar at module load and hands the value over once', async () => {
        window.history.replaceState(null, '', '/events/42?tab=roster#token=abc.def');
        const mod = await import('./magic-link-capture');
        expect(window.location.hash).toBe('');
        expect(window.location.search).toBe('?tab=roster');
        expect(mod.takeCapturedMagicLinkToken()).toBe('abc.def');
        expect(mod.takeCapturedMagicLinkToken()).toBeNull();
    });

    it("is main.tsx's first import, evaluated ahead of ./sentry", () => {
        const specifiers = importsOf('../main.tsx');
        expect(specifiers[0], 'the fragment strip must run before Sentry.init').toBe('./lib/magic-link-capture');
        expect(specifiers.indexOf('./sentry')).toBeGreaterThan(0);
    });

    it('pulls in nothing that could initialise Sentry before the strip', () => {
        expect(importsOf('./magic-link-capture.ts')).toEqual(['./magic-link']);
        expect(importsOf('./magic-link.ts')).toEqual([]);
    });
});

/**
 * ROK-1366 review fix: a classic script that executes before the module
 * entry can read `location.hash` before the strip. A sync or `defer` external
 * script ahead of the entry runs first; an `async` one runs whenever it
 * arrives — even when it sits after the entry. So every external script must
 * come after the entry and be `defer` (same ordered list, runs after it).
 */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

interface ScriptTag {
    attrs: string;
    body: string;
}

function indexHtmlScripts(): ScriptTag[] {
    const html = readFileSync(join(here, '../../index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    return [...html.matchAll(SCRIPT_RE)].map((m) => ({ attrs: m[1], body: m[2] }));
}

const srcOf = (tag: ScriptTag): string | null => /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag.attrs)?.[1] ?? null;
const hasAttr = (tag: ScriptTag, name: string): boolean => new RegExp(`(^|\\s)${name}(\\s|=|$)`, 'i').test(tag.attrs);
const stripJsComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('ROK-1366: index.html runs nothing that can read the fragment before the strip', () => {
    const scripts = indexHtmlScripts();
    const entry = scripts.findIndex((tag) => srcOf(tag) === '/src/main.tsx');

    it('loads no external script ahead of the module entry, and no inline one that reads the URL', () => {
        expect(entry, 'index.html must load /src/main.tsx').toBeGreaterThanOrEqual(0);
        expect(hasAttr(scripts[entry], 'async'), 'an async entry could run after a deferred script').toBe(false);
        const early = scripts.slice(0, entry);
        expect(early.map(srcOf).filter(Boolean), 'these execute before the fragment strip').toEqual([]);
        for (const tag of early) {
            expect(stripJsComments(tag.body), 'inline script ahead of the entry reads the URL').not.toMatch(
                /\blocation\b|\bhref\b|document\.URL/,
            );
        }
    });

    it('loads every third-party script deferred and after the module entry', () => {
        const thirdParty = scripts
            .map((tag, index) => ({ tag, index, src: srcOf(tag) }))
            .filter(({ src }) => src !== null && /^(https?:)?\/\//i.test(src));
        for (const { tag, index, src } of thirdParty) {
            expect({ src, afterEntry: index > entry, defer: hasAttr(tag, 'defer'), async: hasAttr(tag, 'async') }).toEqual({
                src,
                afterEntry: true,
                defer: true,
                async: false,
            });
        }
    });
});
