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
