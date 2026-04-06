/**
 * Shared Playwright test fixture for smoke tests.
 *
 * Wraps page.goto() to use 'domcontentloaded' instead of the default 'load'.
 * The 'load' event never fires when pages render 1000+ external game cover
 * images (IGDB, ITAD CDNs). DOM is fully interactive at domcontentloaded.
 */
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export { expect };

export const test = base.extend<{ page: Page }>({
    page: async ({ page }, use) => {
        const originalGoto = page.goto.bind(page);
        page.goto = ((url: string, options?: Parameters<Page['goto']>[1]) =>
            originalGoto(url, {
                waitUntil: 'domcontentloaded',
                ...options,
            })) as Page['goto'];
        await use(page);
    },
});
