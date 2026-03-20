/**
 * Navigation smoke tests — nav links, header, console errors.
 */
import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
    test('header contains all main nav links', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses desktop header nav');

        await page.goto('/calendar');
        // Both desktop header nav and mobile bottom tab bar have aria-label="Main navigation".
        // Scope to the desktop header nav (inside <header>).
        const nav = page.locator('header nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Games' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Players' })).toBeVisible();
    });

    test('nav links navigate to correct pages', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses desktop header nav');

        await page.goto('/calendar');
        const nav = page.locator('header nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        // Navigate to Events (SPA navigation — no full page load, use heading assertion)
        await nav.getByRole('link', { name: 'Events' }).click();
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 10_000 });

        // Navigate to Games
        await nav.getByRole('link', { name: 'Games' }).click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Navigate to Players
        await nav.getByRole('link', { name: 'Players' }).click();
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 10_000 });

        // Navigate back to Calendar
        await nav.getByRole('link', { name: 'Calendar' }).click();
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 10_000 });
    });

    test('no critical console errors during navigation', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses Calendar heading (hidden md:block)');

        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        // Navigate through each page, waiting for content to load instead of fixed timeouts
        await page.goto('/calendar');
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });

        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await page.goto('/players');
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });

        // Filter out known benign errors (network, favicon, CORS in dev, rate limiting)
        const criticalErrors = errors.filter(
            (e) =>
                !e.includes('net::') &&
                !e.includes('favicon') &&
                !e.includes('404') &&
                !e.includes('429') &&
                !e.includes('CORS') &&
                !e.includes('ERR_CONNECTION_REFUSED') &&
                !e.includes('Failed to load resource'),
        );
        expect(criticalErrors).toHaveLength(0);
    });
});
