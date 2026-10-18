import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defined } from '../test/defined';
import { stripComments } from '../test/strip-comments';
import { readQueryToken, stripQueryToken } from './query-token';

/**
 * ROK-1839: the join flow's `?token=` must be gone from `window.location.href`
 * BEFORE Sentry initialises. Session Replay builds its rrweb Meta (type 4)
 * event's href from `window.location.href` inside the SDK and only hands
 * CUSTOM (type 5) events to `beforeAddRecordingEvent`, so our scrub hook never
 * sees that href — the only fix is for the URL not to carry the token.
 */
const here = dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /^import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm;
const STORAGE_KEY = 'rl.join_token';

function importsOf(file: string): string[] {
    const src = stripComments(readFileSync(join(here, file), 'utf8'));
    return [...src.matchAll(IMPORT_RE)].map((m) => defined(m[1], 'import specifier'));
}

describe('ROK-1839: query-token helpers', () => {
    it.each([
        ['?intent=signup&token=abc.def', 'abc.def'],
        ['?token=abc.def', 'abc.def'],
        ['?intent=signup', null],
        ['', null],
    ])('readQueryToken(%s) -> %s', (search, expected) => {
        expect(readQueryToken({ search })).toBe(expected);
    });

    it.each([
        ['/join', '?intent=signup&eventId=7&token=abc', '', '/join?intent=signup&eventId=7'],
        ['/join', '?token=abc', '#roster', '/join#roster'],
        ['/join', '?token=abc', '', '/join'],
        ['/join', '?intent=signup', '#x', '/join?intent=signup#x'],
    ])('stripQueryToken(%s%s%s) -> %s', (pathname, search, hash, expected) => {
        expect(stripQueryToken({ pathname, search, hash })).toBe(expected);
    });
});

describe('ROK-1839: the join token is captured and stripped at module load', () => {
    beforeEach(() => {
        vi.resetModules();
        window.sessionStorage.clear();
        window.history.replaceState(null, '', '/');
    });

    it('strips ?token= from the address bar, keeping every other param and the fragment', async () => {
        window.history.replaceState(null, '', '/join?intent=signup&eventId=7&token=abc.def#roster');
        const mod = await import('./query-token-capture');
        expect(window.location.search, 'the token must be gone from the address bar').toBe(
            '?intent=signup&eventId=7',
        );
        expect(window.location.hash).toBe('#roster');
        expect(window.location.href).not.toContain('abc.def');
        expect(mod.peekCapturedQueryToken()?.token).toBe('abc.def');
    });

    it('binds the capture to the eventId and intent it arrived with', async () => {
        window.history.replaceState(null, '', '/join?intent=signup&eventId=7&token=abc.def');
        const mod = await import('./query-token-capture');
        expect(mod.peekCapturedQueryToken(), 'the capture carries its page context').toMatchObject({
            token: 'abc.def', eventId: '7', intent: 'signup',
        });
    });

    it('keeps the history entry state the router put there', async () => {
        window.history.replaceState({ usr: 'router-state' }, '', '/join?eventId=7&token=abc.def');
        await import('./query-token-capture');
        expect(window.history.state, "replaceState(null, ...) would discard the router's own entry state")
            .toEqual({ usr: 'router-state' });
    });

    it('mirrors the token into sessionStorage so a reload of the stripped URL still has it', async () => {
        window.history.replaceState(null, '', '/join?intent=signup&eventId=7&token=abc.def');
        await import('./query-token-capture');
        expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null')).toMatchObject({
            token: 'abc.def', eventId: '7', intent: 'signup',
        });

        // The reload: same tab, the already-stripped URL, a fresh module graph.
        vi.resetModules();
        const reloaded = await import('./query-token-capture');
        expect(reloaded.peekCapturedQueryToken()?.token, 'a reload must not lose the token').toBe('abc.def');
        expect(window.location.search).toBe('?intent=signup&eventId=7');
    });

    it('clears the token from memory and sessionStorage once it has been used', async () => {
        window.history.replaceState(null, '', '/join?token=abc.def');
        const mod = await import('./query-token-capture');
        mod.clearCapturedQueryToken();
        expect(mod.peekCapturedQueryToken()).toBeNull();
        expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();

        vi.resetModules();
        const reloaded = await import('./query-token-capture');
        expect(reloaded.peekCapturedQueryToken(), 'a used token must not come back on reload').toBeNull();
    });

    it('leaves a token-less URL and history alone', async () => {
        window.history.replaceState(null, '', '/join?intent=signup#roster');
        const spy = vi.spyOn(window.history, 'replaceState');
        const mod = await import('./query-token-capture');
        expect(spy).not.toHaveBeenCalled();
        expect(mod.peekCapturedQueryToken()).toBeNull();
        expect(window.location.search).toBe('?intent=signup');
        spy.mockRestore();
    });

    /**
     * ROK-1839 (Codex P1 / Opus MAJOR): the post-OAuth hop hands the token
     * over through this door instead of a `/join?...&token=` navigation,
     * which would put it in the address bar with Sentry already running.
     */
    it('accepts a handed-over token without ever touching the address bar', async () => {
        window.history.replaceState(null, '', '/join?intent=signup&eventId=7');
        const mod = await import('./query-token-capture');
        const spy = vi.spyOn(window.history, 'replaceState');

        mod.setCapturedQueryToken({ token: 'handed.over', eventId: '7', intent: 'signup' });

        expect(spy, 'handing a token over must not rewrite the URL').not.toHaveBeenCalled();
        expect(window.location.href).not.toContain('handed.over');
        expect(mod.peekCapturedQueryToken()).toMatchObject({
            token: 'handed.over', eventId: '7', intent: 'signup',
        });
        expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null'), 'and it survives a reload')
            .toMatchObject({ token: 'handed.over', eventId: '7' });
        spy.mockRestore();
    });
});

describe('ROK-1839: the strip is evaluated ahead of Sentry.init', () => {
    it("is imported by main.tsx before ./sentry", () => {
        const specifiers = importsOf('../main.tsx');
        const strip = specifiers.indexOf('./lib/query-token-capture');
        expect(strip, 'main.tsx must import the query-token strip').toBeGreaterThanOrEqual(0);
        expect(strip, 'the strip must precede Sentry').toBeLessThan(specifiers.indexOf('./sentry'));
    });

    it("is imported by sentry.ts before @sentry/react, so chunking cannot reorder it", () => {
        // main.tsx's order alone did not survive bundling once (ROK-1366):
        // src/sentry.ts landed in a shared chunk the entry imports.
        const specifiers = importsOf('../sentry.ts');
        const strip = specifiers.indexOf('./lib/query-token-capture');
        expect(strip, 'sentry.ts must import the query-token strip').toBeGreaterThanOrEqual(0);
        expect(strip).toBeLessThan(specifiers.indexOf('@sentry/react'));
    });

    it('pulls in nothing that could initialise Sentry before the strip', () => {
        expect(importsOf('./query-token-capture.ts')).toEqual(['./query-token']);
        expect(importsOf('./query-token.ts')).toEqual([]);
    });
});

/**
 * ROK-1839 fix round r2 — Opus M2 / Codex P3. `capturedAt` was written and
 * never read, so a capture stayed redeemable for as long as the tab lived.
 */
describe('ROK-1839 r2: a capture expires with the intent token it carries', () => {
    beforeEach(() => {
        vi.resetModules();
        window.sessionStorage.clear();
        window.history.replaceState(null, '', '/join?intent=signup&eventId=7');
    });

    function storeAgedCapture(ageMs: number): void {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            token: 'aged.token', eventId: '7', intent: 'signup', capturedAt: Date.now() - ageMs,
        }));
    }

    it('serves a capture that is still inside the 15-minute TTL', async () => {
        storeAgedCapture(14 * 60 * 1000);
        const mod = await import('./query-token-capture');

        expect(mod.CAPTURE_TTL_MS, "the TTL matches the intent token's own server-side lifetime")
            .toBe(15 * 60 * 1000);
        expect(mod.peekCapturedQueryToken()?.token, 'a 14-minute-old capture is still redeemable')
            .toBe('aged.token');
    });

    it('ignores AND clears a capture past the TTL', async () => {
        storeAgedCapture(15 * 60 * 1000 + 1);
        const mod = await import('./query-token-capture');

        expect(
            mod.peekCapturedQueryToken(),
            'a capture older than the 15-minute TTL must not be redeemable',
        ).toBeNull();
        expect(
            window.sessionStorage.getItem(STORAGE_KEY),
            'and the stale secret leaves storage on the read that notices it',
        ).toBeNull();
    });

    it('treats a record with no timestamp as already expired', async () => {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            token: 'legacy.token', eventId: '7', intent: 'signup',
        }));
        const mod = await import('./query-token-capture');

        expect(
            mod.peekCapturedQueryToken(),
            'a forged or legacy record carrying no `capturedAt` is dropped, not trusted',
        ).toBeNull();
    });

    it('does not expire a token the OAuth hop just handed over', async () => {
        const mod = await import('./query-token-capture');
        mod.setCapturedQueryToken({ token: 'handed.over', eventId: '7', intent: 'signup' });

        expect(mod.peekCapturedQueryToken()?.token, 'a fresh handover is stamped with now')
            .toBe('handed.over');
    });
});
