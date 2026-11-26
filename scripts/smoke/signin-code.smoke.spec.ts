/**
 * ROK-2370 — the login page's Discord-app code sign-in, end to end, then the
 * "Last used" card it leaves behind (desktop + mobile projects).
 *
 * 1. Signed-out login page → "Sign in not working? Try another way" → the
 *    code panel starts a REAL code (`POST /auth/discord/signin-code`).
 * 2. The DEMO fixture `POST /admin/test/signin-code/approve {code, userId}`
 *    stands in for the member tapping "Yes, sign me in" in Discord (bots
 *    cannot click another bot's buttons). It approves as the seeded invitee
 *    fixture user (`getInviteeFixture`), never the admin running the suite.
 * 3. The tab's own poll collects the session and leaves the login page.
 * 4. Signed out (refresh cookie dropped + reload), the login page leads with
 *    the "Last used" card; "Not you?" restores the default layout.
 *
 * Only `/system/status` is patched for THIS page (the CI env may not have
 * Discord sign-in configured): it advertises the Discord provider and the
 * code path. Signed-out context; deterministic waits only, no sleep.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { apiPost, getAdminToken, getInviteeFixture } from './api-helpers';

const TRIGGER = 'Sign in not working? Try another way';
const CODE_SHAPE = /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/;
const DISCORD_PROVIDER = {
    key: 'discord', label: 'Continue with Discord', icon: 'discord',
    loginPath: '/auth/discord', color: '#5865F2',
};

/** Advertise Discord sign-in + the code path on this page only. */
async function patchStatus(page: Page): Promise<void> {
    await page.route('**/system/status', async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as Record<string, unknown>;
        await route.fulfill({
            response: res,
            json: { ...body, isFirstRun: false, discordSigninCode: true, authProviders: [DISCORD_PROVIDER] },
        });
    });
}

/** Open the disclosure and read the code the panel started. */
async function startCode(page: Page): Promise<string> {
    await page.goto('/');
    await page.getByRole('button', { name: TRIGGER }).click();
    const value = page.getByTestId('signin-code-value');
    await expect(value).toHaveText(CODE_SHAPE, { timeout: 15_000 });
    return ((await value.textContent()) ?? '').trim();
}

test.describe('Sign-in code (ROK-2370)', () => {
    test('a Discord-approved code signs this tab in, then the login page offers it as Last used', async ({ browser }) => {
        const [adminToken, invitee] = await Promise.all([getAdminToken(), getInviteeFixture()]);
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
            const page = await context.newPage();
            await patchStatus(page);
            const code = await startCode(page);

            const approved = (await apiPost(adminToken, '/admin/test/signin-code/approve', {
                code, userId: invitee.userId,
            })) as { approved?: boolean };
            expect(approved.approved, `the fixture must approve ${code}`).toBe(true);

            // The panel's own poll collects the session and routes away from login.
            await expect(page.getByRole('button', { name: TRIGGER })).toBeHidden({ timeout: 30_000 });
            await expect(page).toHaveURL(/\/(calendar|onboarding)/, { timeout: 15_000 });

            // Sign out: the refresh cookie IS the session; drop it and reload.
            await context.clearCookies();
            await page.goto('/');
            const card = page.getByTestId('last-used-signin');
            await expect(card).toBeVisible({ timeout: 15_000 });
            await expect(card).toContainText('Last used');
            await expect(card).toContainText('Discord app code');
            await expect(page.getByRole('button', { name: TRIGGER })).toBeHidden();

            await card.getByRole('button', { name: 'Not you?' }).click();
            await expect(card).toBeHidden();
            await expect(page.getByRole('button', { name: TRIGGER })).toBeVisible();
            await expect(page.getByRole('button', { name: /continue with discord/i })).toBeVisible();
        } finally {
            await context.close();
        }
    });
});
