/**
 * Auth smoke tests — login form, credentials, and unauthenticated guard.
 */
import { test, expect } from './base';
import { expandLocalLogin } from './helpers';

test.describe('Auth', () => {
    test('login page renders form fields', async ({ browser }) => {
        // Use a fresh context without storageState to test unauthenticated view
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/');
        await expandLocalLogin(page);

        await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#password')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

        await context.close();
    });

    test('local login with admin@local credentials works', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/');
        await expandLocalLogin(page);

        await page.locator('#username').fill('admin@local');
        await page.locator('#password').fill(process.env.ADMIN_PASSWORD || 'password');
        await page.getByRole('button', { name: 'Sign In' }).click();

        // After login the app may redirect to /calendar, /onboarding, or /setup
        // depending on admin state. Just verify we left the login page.
        await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible({ timeout: 15_000 });

        await context.close();
    });

    test('unauthenticated user is redirected to login', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        // Try to access a protected route
        await page.goto('/events');
        // Should show the login form — look for a sign-in related button
        // (could be "Continue with Discord" or "Sign In" depending on config)
        await expect(
            page.getByRole('button', { name: /sign in|continue with/i }).first()
        ).toBeVisible({ timeout: 15_000 });

        await context.close();
    });
});
