/**
 * Players page smoke tests — heading, player list, total count.
 */
import { test, expect } from '@playwright/test';

test.describe('Players page', () => {
    test('renders heading and player list from seed data', async ({ page }) => {
        await page.goto('/players');
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });

        // Demo data creates ~100 users — the first page shows alphabetically sorted players.
        // "Admin" and "CasualCarl" are consistently on the first page.
        await expect(page.getByText('CasualCarl').first()).toBeVisible({ timeout: 10_000 });
    });

    test('shows total player count', async ({ page }) => {
        await page.goto('/players');
        // The players page shows "N registered" — demo data has ~101 users
        await expect(page.getByText(/registered/i)).toBeVisible({ timeout: 10_000 });
    });
});
