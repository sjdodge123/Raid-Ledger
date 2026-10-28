import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load the module fresh so its module-load capture runs against `url`. */
async function loadAt(url: string): Promise<typeof import('./companion-link-code-capture')> {
    window.history.replaceState(null, '', url);
    vi.resetModules();
    return import('./companion-link-code-capture');
}

/** ROK-1955 Codex P2: the `/link` code leaves the address bar before Sentry/Replay init. */
describe('companion-link-code-capture', () => {
    afterEach(() => window.history.replaceState(null, '', '/'));

    it('captures a fragment code on /link and strips it at module load', async () => {
        const mod = await loadAt('/link#code=BCDF-GHJK');
        expect(window.location.href).not.toContain('BCDF');
        expect(window.location.pathname).toBe('/link');
        expect(mod.takeCapturedLinkCode()).toBe('BCDF-GHJK');
        expect(mod.takeCapturedLinkCode()).toBeNull();
    });

    it('captures a legacy ?code= and keeps unrelated params', async () => {
        const mod = await loadAt('/link?x=1&code=BCDFGHJK');
        expect(window.location.search).toBe('?x=1');
        expect(mod.takeCapturedLinkCode()).toBe('BCDFGHJK');
    });

    it('accepts a trailing slash on /link/', async () => {
        const mod = await loadAt('/link/#code=BCDF-GHJK');
        expect(window.location.href).not.toContain('BCDF');
        expect(mod.takeCapturedLinkCode()).toBe('BCDF-GHJK');
    });

    it('peek does not consume the captured code', async () => {
        const mod = await loadAt('/link#code=BCDF-GHJK');
        expect(mod.peekCapturedLinkCode()).toBe('BCDF-GHJK');
        expect(mod.takeCapturedLinkCode()).toBe('BCDF-GHJK');
        expect(mod.peekCapturedLinkCode()).toBeNull();
    });

    it('withCapturedLinkCode puts the code back in the /link fragment only', async () => {
        const mod = await loadAt('/link?x=1#code=BCDF-GHJK');
        expect(mod.withCapturedLinkCode('/link?x=1')).toBe('/link?x=1#code=BCDF-GHJK');
        expect(mod.withCapturedLinkCode('/link/')).toBe('/link/#code=BCDF-GHJK');
        expect(mod.withCapturedLinkCode('/events')).toBe('/events');
        expect(mod.peekCapturedLinkCode()).toBe('BCDF-GHJK');
    });

    it('withCapturedLinkCode leaves /link alone when nothing was captured', async () => {
        const mod = await loadAt('/link');
        expect(mod.withCapturedLinkCode('/link')).toBe('/link');
    });

    it('leaves other pages alone', async () => {
        const mod = await loadAt('/auth/callback?code=oauth123');
        expect(window.location.search).toBe('?code=oauth123');
        expect(mod.takeCapturedLinkCode()).toBeNull();
    });

    it('sentry.ts imports it ahead of @sentry/react', () => {
        const src = readFileSync(resolve(__dirname, '../sentry.ts'), 'utf8');
        const capture = src.indexOf("import './lib/companion-link-code-capture';");
        expect(capture).toBeGreaterThan(-1);
        expect(capture).toBeLessThan(src.indexOf("from '@sentry/react'"));
    });
});
