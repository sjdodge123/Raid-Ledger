/**
 * Shared Playwright test fixture for smoke tests.
 *
 * - `page`: wraps page.goto() to use 'domcontentloaded' instead of the
 *   default 'load'. The 'load' event never fires when pages render 1000+
 *   external game cover images (IGDB, ITAD CDNs). DOM is fully interactive
 *   at domcontentloaded. A `net::ERR_*` transport failure gets ONE retry
 *   (./goto-retry.ts, TDB:1040); timeouts and HTTP statuses never do.
 *
 * - `world`: per-test `TestWorld` (see ./test-world.ts) that exposes a
 *   unique-prefixed id helper and an automatic cleanup hook. Tests that
 *   create entities (events, lineups) should opt in by destructuring
 *   `{ world }` and using `world.uid('event')` / `world.prefix` on every
 *   created title/slug. Cleanup runs prefix-scoped after each test.
 *
 * - `context`: ROK-1754 — a context on the default (admin) storageState is
 *   signed in with its OWN `rl_rt` refresh family (./browser-session.ts).
 *   The storageState file carries no token: the app keeps its access token in
 *   memory and mints it from that cookie at boot. A spec that sets its own
 *   storageState (e.g. the anonymous `{ cookies: [], origins: [] }`) is left
 *   alone, and a `browser.newContext()` a spec builds itself must call
 *   `signInAsAdmin` / `signInContextAs` explicitly.
 */
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { TestWorld } from './test-world';
import { gotoWithRetry } from './goto-retry';
import { signInAsAdmin } from './browser-session';
import { STORAGE_STATE_PATH } from '../auth-paths';

export { expect };
export { TestWorld };

interface Fixtures {
    context: BrowserContext;
    page: Page;
    world: TestWorld;
}

export const test = base.extend<Fixtures>({
    context: async ({ context, storageState }, use) => {
        if (storageState === STORAGE_STATE_PATH) await signInAsAdmin(context);
        await use(context);
    },
    page: async ({ page }, use) => {
        const originalGoto = page.goto.bind(page);
        page.goto = ((url: string, options?: Parameters<Page['goto']>[1]) =>
            gotoWithRetry(originalGoto, url, {
                waitUntil: 'domcontentloaded',
                ...options,
            })) as Page['goto'];
        await use(page);
    },
    world: async ({}, use, testInfo) => {
        const world = new TestWorld(testInfo);
        try {
            await use(world);
        } finally {
            await world.cleanup();
        }
    },
});
