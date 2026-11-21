/**
 * ROK-2291 — the phone sign-in hint on the login card.
 *
 * Phone layouts (below 1024px: the `mobile` Pixel 5 and `tablet` iPad
 * portrait projects) show it under the Discord button; `desktop` does not.
 *
 * The hint needs Discord sign-in, which the CI smoke env may not have
 * configured, so THIS page's `/system/status` gets a Discord provider and
 * `isFirstRun: false` patched in (the calendar-server-layer idiom). Nothing
 * global is changed. Signed-out context; deterministic waits only.
 */
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './base';
import { isPhoneLayout } from './helpers';

const HINT_COPY = 'On a phone? Sign in once and this browser keeps you signed in. '
    + 'No Discord password handy? Type /login in our Discord server for a sign-in link.';

const DISCORD_PROVIDER = {
    key: 'discord', label: 'Continue with Discord', icon: 'discord',
    loginPath: '/auth/discord', color: '#5865F2',
};

/** A signed-out page whose system status offers Discord sign-in. */
async function openLoginWithDiscord(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.route('**/system/status', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({ response: res, json: { ...body, isFirstRun: false, authProviders: [DISCORD_PROVIDER] } });
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /continue with discord/i })).toBeVisible({ timeout: 15_000 });
    return { page, close: () => context.close() };
}

test.describe('Login phone sign-in hint (ROK-2291)', () => {
    test('phones show the hint under the Discord button; desktop does not', async ({ browser }, testInfo) => {
        const { page, close } = await openLoginWithDiscord(browser);
        const hint = page.getByTestId('phone-signin-hint');
        if (isPhoneLayout(testInfo)) {
            await expect(hint).toBeVisible();
            await expect(hint).toHaveText(HINT_COPY);
            await expect(hint.locator('code')).toHaveText('/login');
            const discordBox = await page.getByRole('button', { name: /continue with discord/i }).boundingBox();
            const hintBox = await hint.boundingBox();
            const toggleBox = await page.getByRole('button', { name: 'Sign in with username instead' }).boundingBox();
            expect(discordBox && hintBox && toggleBox, 'all three are laid out').toBeTruthy();
            if (discordBox && hintBox && toggleBox) {
                expect(hintBox.y).toBeGreaterThan(discordBox.y);
                expect(toggleBox.y).toBeGreaterThan(hintBox.y);
            }
        } else {
            await expect(page.getByRole('button', { name: 'Sign in with username instead' })).toBeVisible();
            await expect(hint).toHaveCount(0);
        }
        await close();
    });
});
