import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

    it("is sentry.ts's first import, so the strip precedes Sentry.init in any chunk layout", () => {
        // main.tsx's order did not survive bundling: src/sentry.ts landed in a
        // shared chunk the entry imports, so it evaluated before the entry body.
        const specifiers = importsOf('../sentry.ts');
        expect(specifiers[0], 'sentry.ts must import the fragment strip before @sentry/react').toBe(
            './lib/magic-link-capture',
        );
        expect(specifiers.indexOf('@sentry/react')).toBeGreaterThan(0);
    });

    it('pulls in nothing that could initialise Sentry before the strip', () => {
        expect(importsOf('./magic-link-capture.ts')).toEqual(['./magic-link']);
        expect(importsOf('./magic-link.ts')).toEqual([]);
    });
});

/**
 * ROK-1366 review fix: a classic script that executes before the module
 * entry can read `location.hash` before the strip, and an `async` one runs
 * whenever it arrives — even when it sits after the entry. A `defer` one after
 * the entry was safe but held DOMContentLoaded and changed the boot order
 * (PR #1384 CI). So index.html carries NO external script besides the entry:
 * third-party code is injected by the entry itself, after the strip.
 */
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const ENTRY_SRC = '/src/main.tsx';
const TOOLTIPS_URL_RE = /zamimg\.com\/js\/tooltips\.js/;

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

/** Non-test source files under web/src that mention the tooltips.js URL (comments stripped). */
function srcFilesLoadingTooltips(): string[] {
    const srcRoot = join(here, '..');
    return (readdirSync(srcRoot, { recursive: true }) as string[])
        .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
        .filter((f) => TOOLTIPS_URL_RE.test(stripJsComments(readFileSync(join(srcRoot, f), 'utf8'))))
        .map((f) => f.split('\\').join('/'));
}

describe('ROK-1366: index.html runs nothing that can read the fragment before the strip', () => {
    const scripts = indexHtmlScripts();
    const entry = scripts.findIndex((tag) => srcOf(tag) === ENTRY_SRC);

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

    it('loads no external script at all besides the module entry', () => {
        const external = scripts.map(srcOf).filter((src) => src !== null && src !== ENTRY_SRC);
        expect(external, 'inject third-party scripts from the entry, after the strip').toEqual([]);
        expect(scripts.some((tag) => TOOLTIPS_URL_RE.test(stripJsComments(tag.body)))).toBe(false);
    });
});

describe('ROK-1366: tooltips.js is injected by the entry, only after the strip', () => {
    it("is injected by main.tsx's second import, straight after ./lib/magic-link-capture", () => {
        expect(importsOf('../main.tsx').slice(0, 2)).toEqual(['./lib/magic-link-capture', './lib/wowhead-tooltips-loader']);
    });

    it('the loader imports nothing, so it cannot evaluate anything ahead of the strip', () => {
        expect(importsOf('./wowhead-tooltips-loader.ts')).toEqual([]);
    });

    it('no other source file loads tooltips.js', () => {
        expect(srcFilesLoadingTooltips()).toEqual(['lib/wowhead-tooltips-loader.ts']);
    });
});
