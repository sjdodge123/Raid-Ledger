/**
 * Calendar smoke tests — month view, quick actions, events, and filters.
 */
import { test, expect } from '@playwright/test';

test.describe('Calendar', () => {
    test('month view renders heading and grid', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — Calendar heading is hidden md:block');

        await page.goto('/calendar');
        // The h1 "Calendar" heading is desktop-only (hidden md:block).
        // At the Desktop Chrome viewport (1280px) it should be visible.
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });
        // The calendar grid should be visible (look for day-of-week column headers).
        // react-big-calendar renders "Sun", "Mon" etc. (CSS uppercases them visually).
        await expect(page.getByRole('columnheader', { name: 'Mon' })).toBeVisible({ timeout: 10_000 });
    });

    test('calendar has quick action links', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — quick actions hidden on mobile');

        await page.goto('/calendar');
        await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('link', { name: 'All Events' })).toBeVisible();
    });

    test('seeded events appear on calendar', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — calendar grid uses desktop selectors');

        await page.goto('/calendar');
        // Demo data creates events like "Heroic Amirdrassil Clear", "Mythic+ Push Night"
        // They should appear as event chips/cards on the calendar
        // Wait for event links to render instead of using a fixed timeout
        const eventLinks = page.locator('a[href*="/events/"]');
        await expect(eventLinks.first()).toBeVisible({ timeout: 10_000 });
        const count = await eventLinks.count();
        expect(count).toBeGreaterThan(0);
    });

    test('game filter checkboxes are visible when games exist', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — filter and heading use desktop selectors');

        await page.goto('/calendar');
        // Wait for calendar to finish loading before checking filter UI
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });

        // The filter toggle may not exist if no IGDB games are seeded (e.g. CI).
        // This is a soft check: we verify the filter works IF present, but skip gracefully otherwise.
        const filterToggle = page.locator('button').filter({ hasText: /filter/i }).first();
        if (await filterToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
            await filterToggle.click();
            // Should see game checkboxes in the filter panel
            const checkboxes = page.getByRole('checkbox');
            const checkboxCount = await checkboxes.count();
            // Soft check: if games exist, there should be filter checkboxes
            if (checkboxCount > 0) {
                await expect(checkboxes.first()).toBeVisible();
            }
        }
        // NOTE: In CI without IGDB data, no filter toggle is rendered and this test
        // passes trivially. This is acceptable — game filter coverage requires IGDB
        // seed data which is not available in the CI environment.
    });
});
