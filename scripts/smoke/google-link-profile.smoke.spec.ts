/**
 * ROK-2371 — Sign in with Google: the Profile link entry point and the admin
 * toggle. Desktop AND mobile. No real Google round trip (CI has no client):
 * the spec turns Google sign-in on through the admin API with a placeholder
 * client id + secret in the SAME PUT, checks the UI, and restores in `finally`.
 *
 * The shared lock + restore live in google-signin-setting.helpers.ts.
 */
import { test, expect } from './base';
import { withGoogleSignin } from './google-signin-setting.helpers';

// A test may wait for the other project's test to release the lock first.
test.describe.configure({ timeout: 90_000 });

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
