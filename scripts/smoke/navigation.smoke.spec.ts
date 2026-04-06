/**
 * Navigation smoke tests — nav links, header, console errors.
 * Desktop tests use the header nav; mobile tests use the bottom tab bar.
 */
import { test, expect } from './base';
import { isMobile } from './helpers';

test.describe('Navigation (desktop)', () => {
    test('header contains all main nav links', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — uses header nav');

        await page.goto('/calendar');
        const nav = page.locator('header nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Games' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Players' })).toBeVisible();
    });

    test('nav links navigate to correct pages', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — uses header nav');

        await page.goto('/calendar');
        const nav = page.locator('header nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        await nav.getByRole('link', { name: 'Events' }).click();
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 10_000 });

        await nav.getByRole('link', { name: 'Games' }).click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await nav.getByRole('link', { name: 'Players' }).click();
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 10_000 });

        await nav.getByRole('link', { name: 'Calendar' }).click();
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 10_000 });
    });

    test('no critical console errors during navigation', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — Calendar heading hidden on mobile');

        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        await page.goto('/calendar');
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });

        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await page.goto('/players');
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });

        const criticalErrors = filterBenignErrors(errors);
        expect(criticalErrors).toHaveLength(0);
    });
});

test.describe('Navigation (mobile)', () => {
    test('bottom tab bar contains all main nav links', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — uses bottom tab bar');

        await page.goto('/calendar');
        // Both desktop header nav and bottom tab bar use aria-label="Main navigation".
        // The header nav is hidden on mobile (hidden md:flex); the bottom tab bar
        // renders last in the DOM and is the only visible nav on mobile.
        const tabBar = page.locator('nav[aria-label="Main navigation"]').last();
        await expect(tabBar).toBeVisible({ timeout: 15_000 });

        await expect(tabBar.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(tabBar.getByRole('link', { name: 'Events' })).toBeVisible();
        await expect(tabBar.getByRole('link', { name: 'Games' })).toBeVisible();
        await expect(tabBar.getByRole('link', { name: 'Players' })).toBeVisible();
    });

    test('bottom tab bar links navigate to correct pages', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — uses bottom tab bar');

        await page.goto('/calendar');
        // Bottom tab bar is the fixed nav at the bottom — use the mobile toolbar selector
        const tabBar = page.locator('nav.fixed, nav[aria-label="Main navigation"]').last();
        await expect(tabBar).toBeVisible({ timeout: 15_000 });

        // Use evaluate to click programmatically — bypasses Playwright viewport checks
        const eventsLink = tabBar.getByRole('link', { name: 'Events' });
        await eventsLink.evaluate((el: HTMLElement) => el.click());
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 10_000 });

        // Navigate to Games
        await tabBar.getByRole('link', { name: 'Games' }).evaluate((el: HTMLElement) => el.click());
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Navigate to Players
        await tabBar.getByRole('link', { name: 'Players' }).evaluate((el: HTMLElement) => el.click());
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 10_000 });

        // Navigate back to Calendar — heading is hidden (md:block), use mobile toolbar
        await tabBar.getByRole('link', { name: 'Calendar' }).evaluate((el: HTMLElement) => el.click());
        await expect(page.getByLabel('Calendar view switcher')).toBeVisible({ timeout: 10_000 });
    });

    test('no critical console errors during navigation', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only');

        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        // Calendar heading is hidden on mobile — use the mobile toolbar instead
        await page.goto('/calendar');
        await expect(page.getByLabel('Calendar view switcher')).toBeVisible({ timeout: 15_000 });

        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await page.goto('/players');
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });

        const criticalErrors = filterBenignErrors(errors);
        expect(criticalErrors).toHaveLength(0);
    });

    test('hamburger opens more drawer', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — hamburger menu');

        await page.goto('/calendar');
        await expect(page.getByLabel('Calendar view switcher')).toBeVisible({ timeout: 15_000 });

        // Open the hamburger menu
        await page.getByRole('button', { name: 'Open menu' }).click();

        // The drawer should be visible with expected sections
        const drawer = page.getByTestId('more-drawer-panel');
        await expect(drawer).toBeVisible({ timeout: 5_000 });
        await expect(drawer.getByText('More')).toBeVisible();

        // Close the drawer
        await page.getByRole('button', { name: 'Close menu' }).click();
        await expect(drawer).not.toBeVisible({ timeout: 5_000 });
    });
});

/** Filter out known benign console errors (network, favicon, CORS, rate limiting). */
function filterBenignErrors(errors: string[]): string[] {
    return errors.filter(
        (e) =>
            !e.includes('net::') &&
            !e.includes('favicon') &&
            !e.includes('404') &&
            !e.includes('429') &&
            !e.includes('CORS') &&
            !e.includes('ERR_CONNECTION_REFUSED') &&
            !e.includes('Failed to load resource'),
    );
}
