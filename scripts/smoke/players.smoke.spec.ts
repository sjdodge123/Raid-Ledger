/**
 * Players page smoke tests — heading, player list, total count.
 *
 * Mobile parity: all selectors are viewport-agnostic (ARIA roles, text
 * matchers, href attribute selectors) so these tests run on both the
 * desktop and mobile Playwright projects without skips.  Verified at
 * 375×812 via MCP exploration (ROK-892).
 */
import { test, expect } from './base';

test.describe('Players page', () => {
    test('renders heading and player list from seed data', async ({ page }) => {
        await page.goto('/players');
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });

        // Demo data creates ~100 users — the default view shows "New Members" sorted by join date.
        // Verify at least one player link is visible (any seeded user).
        await expect(page.getByRole('heading', { name: 'New Members' })).toBeVisible({ timeout: 10_000 });
        const playerLinks = page.locator('a[href*="/users/"]');
        await expect(playerLinks.first()).toBeVisible({ timeout: 10_000 });
    });

    test('shows total player count', async ({ page }) => {
        await page.goto('/players');
        // The players page shows "N registered" — demo data has ~101 users
        await expect(page.getByText(/registered/i)).toBeVisible({ timeout: 10_000 });
    });
});
