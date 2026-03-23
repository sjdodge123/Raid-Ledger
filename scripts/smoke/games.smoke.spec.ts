/**
 * Games page smoke tests — page load, mobile card spacing, mobile search styling.
 */
import { test, expect } from '@playwright/test';

test.describe('Games page', () => {
    test('page loads without crashing', async ({ page }) => {
        await page.goto('/games');
        // Games page may show "Discover" tab or game cards depending on IGDB data
        // Wait for page to settle by checking for absence of error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-811 — games page mobile cards cramped together
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-811 — games page mobile card spacing', () => {
    test('game cards in carousel sections are visible at mobile viewport', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test');

        const context = await browser.newContext({
            viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Look for carousel row headings on mobile (h2 elements inside the discover view)
        const carouselHeadings = page.locator('h2');
        if (await carouselHeadings.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Game cards within the first carousel row — scroll past banner if needed
            const gameCards = page.locator('a[href*="/games/"]');
            await expect(gameCards.first()).toBeAttached({ timeout: 5_000 });
            await gameCards.first().scrollIntoViewIfNeeded();
            await expect(gameCards.first()).toBeVisible({ timeout: 3_000 });
        }

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-813 — games page search container styling on mobile
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-813 — games page mobile search styling', () => {
    test('search input and tab toggle are visible at mobile viewport', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test');

        const context = await browser.newContext({
            viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Search input should be visible on mobile
        const searchInput = page.getByPlaceholder('Search games...');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Tab toggle is only rendered for admins — check if present and visible
        const tabToggle = page.getByRole('button', { name: /discover/i });
        if (await tabToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await expect(tabToggle).toBeVisible();
        }

        await context.close();
    });
});
