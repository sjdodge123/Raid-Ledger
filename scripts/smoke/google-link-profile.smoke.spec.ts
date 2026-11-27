/**
 * ROK-2371 — Sign in with Google: the Profile link entry point and the admin
 * toggle. Desktop AND mobile. No real Google round trip (CI has no client):
 * the spec turns Google sign-in on through the admin API with a placeholder
 * client id + secret in the SAME PUT, checks the UI, and restores in `finally`.
 *
 * The toggle is GLOBAL and both projects share one DB, so the enable → assert
 * → restore window is held under a cross-worker lock directory: otherwise one
 * project's restore would switch sign-in off under the other's assertions.
 */
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './base';
import { apiGet, apiPut, getAdminToken, pollForCondition } from './api-helpers';

const SETTINGS = '/admin/settings/calendar-sync';
const LOCK_DIR = join(tmpdir(), 'rl-smoke-google-signin.lock');
const LOCK_STALE_MS = 120_000;

// A test may wait for the other project's test to release the lock first.
test.describe.configure({ timeout: 90_000 });

interface GoogleSettings {
    googleSigninEnabled?: boolean;
    google: { clientId: string | null; hasSecret: boolean };
    redirectUris: { googleSignin?: string[] };
}

function tryLock(): boolean {
    try {
        mkdirSync(LOCK_DIR);
        return true;
    } catch {
        // A crashed run's lock: older than any test could hold it.
        try { if (Date.now() - statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) rmSync(LOCK_DIR, { recursive: true }); } catch { /* raced */ }
        return false;
    }
}

/** Enable Google sign-in (placeholder client only where none is stored); returns the restore body. */
async function enableGoogleSignin(token: string): Promise<Record<string, unknown>> {
    const before = (await apiGet(token, SETTINGS)) as GoogleSettings;
    const google: Record<string, string> = {};
    if (!before.google.clientId) google.clientId = 'smoke-placeholder.apps.googleusercontent.com';
    if (!before.google.hasSecret) google.clientSecret = 'smoke-placeholder-secret';
    const res = await apiPut(token, SETTINGS, { googleSigninEnabled: true, ...(Object.keys(google).length ? { google } : {}) });
    expect(res, 'PUT enabling Google sign-in').toMatchObject({ googleSigninEnabled: true });
    await pollForCondition(async () => {
        const status = (await apiGet(token, '/system/status')) as { authProviders?: { key: string }[] } | null;
        return status?.authProviders?.some((p) => p.key === 'google') ?? false;
    }, { description: '/system/status lists the google login method', timeoutMs: 20_000 });
    const restoreGoogle: Record<string, string> = {};
    if (google.clientId) restoreGoogle.clientId = '';
    if (google.clientSecret) restoreGoogle.clientSecret = '';
    return { googleSigninEnabled: before.googleSigninEnabled ?? false, ...(Object.keys(restoreGoogle).length ? { google: restoreGoogle } : {}) };
}

async function withGoogleSignin(run: (settings: GoogleSettings) => Promise<void>): Promise<void> {
    await expect.poll(tryLock, { message: 'acquire the Google sign-in smoke lock', timeout: 75_000 }).toBe(true);
    const token = await getAdminToken();
    let restore: Record<string, unknown> | null = null;
    try {
        restore = await enableGoogleSignin(token);
        await run((await apiGet(token, SETTINGS)) as GoogleSettings);
    } finally {
        if (restore) await apiPut(token, SETTINGS, restore);
        rmSync(LOCK_DIR, { recursive: true, force: true });
    }
}

test('Profile → Integrations offers "Link Google" while Google sign-in is on', async ({ page }) => {
    await withGoogleSignin(async () => {
        await page.goto('/profile/integrations');
        await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
        const link = page.getByTestId('link-google');
        await expect(link).toBeVisible();
        await expect(link).toHaveText(/Link Google/);
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport({ ratio: 1 });
    });
});

test('Admin → Calendar Sync shows the Google sign-in toggle, both URIs and the checklist', async ({ page }) => {
    await withGoogleSignin(async (settings) => {
        await page.goto('/admin/settings/integrations/calendar-sync');
        const block = page.getByTestId('google-signin-block');
        await expect(block.getByRole('switch', { name: 'Allow sign-in with Google' })).toHaveAttribute('aria-checked', 'true');
        const [signinUri, linkUri] = settings.redirectUris.googleSignin ?? [];
        expect(signinUri && linkUri, 'server serves both sign-in redirect URIs').toBeTruthy();
        await expect(block.getByRole('textbox', { name: 'Google sign-in redirect URI' })).toHaveValue(signinUri ?? '');
        await expect(block.getByRole('textbox', { name: 'Google link redirect URI' })).toHaveValue(linkUri ?? '');
        await expect(block.getByTestId('google-signin-checklist').getByRole('listitem')).toHaveCount(4);
        await expect(block).toContainText('OAuth consent screen is In production');
    });
});
