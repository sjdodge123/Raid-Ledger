/**
 * ROK-2371: Sign in with Google on the login page (desktop + mobile). Turns
 * Google sign-in on through the admin calendar-sync PUT (it 400s without a
 * Google client, so a placeholder client id + secret ride in the same PUT
 * when none is stored), then checks the signed-out login page: Discord and
 * Google are both top-level buttons, and "Try another way" holds the rest.
 * No real Google round trip. The prior setting is restored in `finally`.
 */
import { test, expect } from './base';
import { apiGet, apiPut, getAdminToken } from './api-helpers';
import { stubSigninCodeStart } from './helpers';

const SETTINGS = '/admin/settings/calendar-sync';
const TRY_ANOTHER_WAY = 'Sign in not working? Try another way';

interface Prior { signinEnabled: boolean; placeholderClient: boolean }

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** Read the current toggle + whether a Google client is stored (loud on an unexpected shape). */
async function readPrior(token: string): Promise<Prior> {
    const body: unknown = await apiGet(token, SETTINGS);
    if (!isRecord(body)) throw new Error(`calendar-sync settings: ${JSON.stringify(body)}`);
    const google = isRecord(body.google) ? body.google : {};
    const hasClient = typeof google.clientId === 'string' && google.clientId !== '' && google.hasSecret === true;
    return { signinEnabled: body.googleSigninEnabled === true, placeholderClient: !hasClient };
}

async function enableGoogleSignin(token: string, prior: Prior): Promise<void> {
    const client = prior.placeholderClient
        ? { google: { clientId: 'smoke-placeholder.apps.googleusercontent.com', clientSecret: 'smoke-placeholder-secret' } }
        : {};
    const res: unknown = await apiPut(token, SETTINGS, { ...client, googleSigninEnabled: true });
    if (isRecord(res) && typeof res.statusCode === 'number' && res.statusCode >= 400) {
        throw new Error(`enable Google sign-in: ${JSON.stringify(res)}`);
    }
}

/** Whether the server offers Discord OAuth on this target (CI may run without it). */
async function discordOffered(token: string): Promise<boolean> {
    const status: unknown = await apiGet(token, '/system/status');
    const providers = isRecord(status) && Array.isArray(status.authProviders) ? status.authProviders : [];
    return providers.some((p) => isRecord(p) && p.key === 'discord');
}

async function restore(token: string, prior: Prior): Promise<void> {
    const client = prior.placeholderClient ? { google: { clientId: '', clientSecret: '' } } : {};
    await apiPut(token, SETTINGS, { googleSigninEnabled: prior.signinEnabled, ...client });
}

test.describe('Sign in with Google (ROK-2371)', () => {
    test('login page shows Discord and Google top-level; Try another way holds the rest', async ({ browser }) => {
        const token = await getAdminToken();
        const prior = await readPrior(token);
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
            await enableGoogleSignin(token, prior);
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
            await restore(token, prior);
        }
    });
});
