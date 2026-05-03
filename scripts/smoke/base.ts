/**
 * Shared Playwright test fixture for smoke tests.
 *
 * - `page`: wraps page.goto() to use 'domcontentloaded' instead of the
 *   default 'load'. The 'load' event never fires when pages render 1000+
 *   external game cover images (IGDB, ITAD CDNs). DOM is fully interactive
 *   at domcontentloaded.
 *
 * - `world`: per-test `TestWorld` (see ./test-world.ts) that exposes a
 *   unique-prefixed id helper and an automatic cleanup hook. Tests that
 *   create entities (events, lineups) should opt in by destructuring
 *   `{ world }` and using `world.uid('event')` / `world.prefix` on every
 *   created title/slug. Cleanup runs prefix-scoped after each test.
 */
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { TestWorld } from './test-world';

export { expect };
export { TestWorld };

interface Fixtures {
    page: Page;
    world: TestWorld;
}

export const test = base.extend<Fixtures>({
    page: async ({ page }, use) => {
        const originalGoto = page.goto.bind(page);
        page.goto = ((url: string, options?: Parameters<Page['goto']>[1]) =>
            originalGoto(url, {
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
