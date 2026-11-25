/**
 * ROK-2319 — the catch-all route. An unknown or mistyped URL used to render the
 * layout with a blank main area; it now shows the shared not-found page with a
 * link home, for a member and for a signed-out visitor alike (the route sits
 * outside the AuthGuard, so a signed-out visitor is not bounced to sign-in).
 *
 * Runs on every project (desktop + mobile in CI). Deterministic waits only — NEVER sleep().
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';

const UNKNOWN_PATH = '/this-page-does-not-exist-rok-2319';

async function expectNotFound(page: Page): Promise<void> {
    await page.goto(UNKNOWN_PATH);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`${UNKNOWN_PATH}$`));
}

test.describe('Unknown URL (ROK-2319)', () => {
    test('a member sees the not-found page, and Go home leaves it', async ({ page }) => {
        await expectNotFound(page);
        const home = page.getByRole('link', { name: 'Go home' });
        await expect(home).toHaveAttribute('href', '/');
        await home.click();
        await expect(page).not.toHaveURL(new RegExp(UNKNOWN_PATH));
        await expect(page.getByRole('heading', { name: 'Page not found' })).toBeHidden();
    });

    test.describe('signed out', () => {
        test.use({ storageState: { cookies: [], origins: [] } });

        test('a signed-out visitor sees the same page, not a redirect loop', async ({ page }) => {
            await expectNotFound(page);
            await expect(page.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
        });
    });
});
