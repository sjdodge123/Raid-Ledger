/**
 * ROK-2371: Sign in with Google on the login page (desktop + mobile). Turns
 * Google sign-in on through the admin calendar-sync PUT (it 400s without a
 * Google client, so a placeholder client id + secret ride in the same PUT
 * when none is stored), then checks the signed-out login page: Discord and
 * Google are both top-level buttons, and "Try another way" holds the rest.
 * No real Google round trip. The shared helper (google-signin-setting.helpers.ts) serialises the desktop and
 * mobile projects under a lock and restores only what it changed.
 */
import { test, expect } from './base';
import { apiGet } from './api-helpers';
import { stubSigninCodeStart } from './helpers';
import { withGoogleSignin } from './google-signin-setting.helpers';

const TRY_ANOTHER_WAY = 'Sign in not working? Try another way';

// A test may wait for the other project's test to release the lock first.
test.describe.configure({ timeout: 90_000 });

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether the server offers Discord OAuth on this target (CI may run without it). */
async function discordOffered(token: string): Promise<boolean> {
    const status: unknown = await apiGet(token, '/system/status');
    const providers = isRecord(status) && Array.isArray(status.authProviders) ? status.authProviders : [];
    return providers.some((p) => isRecord(p) && p.key === 'discord');
}

test.describe('Sign in with Google (ROK-2371)', () => {
    test('login page shows Discord and Google top-level; Try another way holds the rest', async ({ browser }) => {
        await withGoogleSignin(async (_settings, token) => {
            const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
            try {
                const page = await context.newPage();
                await page.goto('/');
                const google = page.getByRole('button', { name: 'Sign in with Google' });
                // /system/status may be served from a short cache: reload until the toggle shows.
                await expect(async () => {
                    await page.reload();
                    await expect(google).toBeVisible({ timeout: 3_000 });
                }).toPass({ timeout: 30_000 });
                if (await discordOffered(token)) {
                    await expect(page.getByRole('button', { name: /Discord/ }).first(), 'Discord stays top-level').toBeVisible();
                }
                await expect(page.locator('#username'), 'username form stays behind Try another way').toHaveCount(0);
                await stubSigninCodeStart(page);
                await page.getByRole('button', { name: TRY_ANOTHER_WAY }).click();
                const disclosure = page.getByTestId('signin-another-way');
                await expect(disclosure).toBeVisible();
                await expect(disclosure.getByRole('button', { name: 'Sign in with Google' }), 'Google is never an alternate').toHaveCount(0);
                await expect(disclosure.getByRole('button', { name: 'Sign in with username' })
                    .or(disclosure.locator('#username'))).toBeVisible();
            } finally {
                await context.close();
            }
        });
    });
});
