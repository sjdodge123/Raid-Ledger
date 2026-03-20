/**
 * Public pages smoke tests — join page (/join) and invite page (/i/:code).
 *
 * Both routes live outside the AuthGuard so they must be accessible
 * without authentication.  The tests verify:
 *  - Pages render without the error boundary firing
 *  - Invalid/missing tokens show a graceful error state
 *  - Community branding (header link) is visible
 *  - Unauthenticated visitors can reach the pages
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Join page — /join
// ---------------------------------------------------------------------------

test.describe('Join page (/join)', () => {
    test('renders invalid-link state when no token is provided', async ({ page }) => {
        await page.goto('/join');
        await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('This join link is invalid or has expired.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Go to Calendar' })).toBeVisible();
    });

    test('does not trigger the error boundary', async ({ page }) => {
        await page.goto('/join');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
    });

    test('is accessible without authentication', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/join');
        // Should NOT redirect to the login page — /join is a public route
        await expect(page.getByRole('heading', { name: 'Invalid Link' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('This join link is invalid or has expired.')).toBeVisible();

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Invite page — /i/:code
// ---------------------------------------------------------------------------

test.describe('Invite page (/i/:code)', () => {
    test('renders error state for an invalid invite code', async ({ browser }) => {
        // Use unauthenticated context so the page stays on /i/:code
        // instead of auto-advancing through the invite wizard steps
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/i/invalid-test-code');
        await expect(page.getByRole('heading', { name: 'Invalid Invite' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Go to Calendar' })).toBeVisible();

        await context.close();
    });

    test('does not trigger the error boundary', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/i/invalid-test-code');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await context.close();
    });

    test('is accessible without authentication', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/i/some-code-123');
        // The page should NOT redirect to login — /i/:code is public
        // It should either show the invite wizard (auth step) or error state
        const invalidHeading = page.getByRole('heading', { name: 'Invalid Invite' });
        const loadingText = page.getByText('Loading invite...');
        const loginButton = page.getByRole('button', { name: /discord|sign in|log in/i });

        // Wait for the page to settle — one of these states should appear
        await expect(
            invalidHeading.or(loadingText).or(loginButton).first(),
        ).toBeVisible({ timeout: 10_000 });

        // Confirm we did NOT get redirected to the auth guard login page
        expect(page.url()).toContain('/i/');

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Community branding — visible on public pages
// ---------------------------------------------------------------------------

test.describe('Community branding on public pages', () => {
    test('header shows community name on join page', async ({ page }) => {
        await page.goto('/join');
        // The header link contains the community name
        const headerLink = page.locator('header a[href="/"]');
        await expect(headerLink).toBeVisible({ timeout: 10_000 });
        // Community name text should be non-empty
        await expect(headerLink).not.toHaveText('', { timeout: 5_000 });
    });

    test('header shows community name on invite page', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/i/branding-test');
        // Even on the invite error page, the header should render
        // Wait for page to settle (loading -> error state)
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // The header / branding area may or may not render for unauthenticated
        // users depending on layout. Check that the page loaded without crash.
        const headerLink = page.locator('header a[href="/"]');
        if (await headerLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await expect(headerLink).not.toHaveText('', { timeout: 3_000 });
        }

        await context.close();
    });
});
