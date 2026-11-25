/**
 * ROK-2370 (replaces ROK-2291's phone hint) — the login card's "Sign in not
 * working? Try another way" disclosure, on every layout.
 *
 * The CI smoke env may not have Discord sign-in or the bot, so THIS page's
 * `/system/status` is patched (the calendar-server-layer idiom) and the code
 * endpoints are fulfilled with a fixed pending code. Nothing global changes.
 * Signed-out context; deterministic waits only. The real end-to-end approval
 * lives in `signin-code.spec.ts`.
 */
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './base';

const TRIGGER = 'Sign in not working? Try another way';
const CODE = 'K7QD-2M9X';
const EXPIRES = '2099-01-01T00:00:00.000Z';

const DISCORD_PROVIDER = {
    key: 'discord', label: 'Continue with Discord', icon: 'discord',
    loginPath: '/auth/discord', color: '#5865F2',
};

/** A signed-out login page offering Discord sign-in, with or without the code path. */
async function openLogin(browser: Browser, discordSigninCode: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.route('**/system/status', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({ response: res, json: { ...body, isFirstRun: false, discordSigninCode, authProviders: [DISCORD_PROVIDER] } });
    });
    await page.route('**/auth/discord/signin-code', (route) => route.fulfill({
        json: { code: CODE, deviceSecret: 's'.repeat(43), expiresAt: EXPIRES, pollIntervalMs: 60_000 },
    }));
    await page.route('**/auth/discord/signin-code/poll', (route) => route.fulfill({ json: { status: 'pending', expiresAt: EXPIRES } }));
    await page.goto('/');
    await expect(page.getByRole('button', { name: /continue with discord/i })).toBeVisible({ timeout: 15_000 });
    return { page, close: () => context.close() };
}

test.describe('Login "Try another way" disclosure (ROK-2370)', () => {
    test('closed by default under the Discord button; no phone hint; password hidden', async ({ browser }) => {
        const { page, close } = await openLogin(browser, true);
        try {
            const trigger = page.getByRole('button', { name: TRIGGER });
            await expect(trigger).toBeVisible();
            await expect(trigger).toHaveAttribute('aria-expanded', 'false');
            await expect(page.getByTestId('phone-signin-hint')).toHaveCount(0);
            await expect(page.locator('#username')).toHaveCount(0);
            const discordBox = await page.getByRole('button', { name: /continue with discord/i }).boundingBox();
            const triggerBox = await trigger.boundingBox();
            expect(discordBox && triggerBox, 'both are laid out').toBeTruthy();
            if (discordBox && triggerBox) expect(triggerBox.y).toBeGreaterThanOrEqual(discordBox.y + discordBox.height);
        } finally {
            await close();
        }
    });

    test('opens on the Discord-app code, with username/password one tap away', async ({ browser }) => {
        const { page, close } = await openLogin(browser, true);
        try {
            await page.getByRole('button', { name: TRIGGER }).click();
            await expect(page.getByRole('heading', { name: 'Sign in another way' })).toBeVisible();
            await expect(page.getByTestId('signin-code-value')).toHaveText(CODE);
            await expect(page.getByText(`In Discord, type /login code:${CODE} and tap Yes, sign me in.`)).toBeVisible();
            await page.getByRole('button', { name: 'Sign in with username' }).click();
            await expect(page.locator('#username')).toBeVisible();
            await expect(page.getByTestId('signin-code-value')).toHaveCount(0);
        } finally {
            await close();
        }
    });

    test('without the code path the disclosure holds only username/password', async ({ browser }) => {
        const { page, close } = await openLogin(browser, false);
        try {
            await page.getByRole('button', { name: TRIGGER }).click();
            await expect(page.locator('#username')).toBeVisible();
            await expect(page.getByTestId('signin-code-value')).toHaveCount(0);
        } finally {
            await close();
        }
    });
});
