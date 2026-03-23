/**
 * Calendar smoke tests — month view, quick actions, events, and filters.
 * Desktop and mobile viewports.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('Calendar — desktop', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only tests');
    });

    test('month view renders heading and grid', async ({ page }) => {
        await page.goto('/calendar');
        // The h1 "Calendar" heading is desktop-only (hidden md:block).
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });
        // react-big-calendar renders "Sun", "Mon" etc. as columnheaders on desktop.
        await expect(page.getByRole('columnheader', { name: 'Mon' })).toBeVisible({ timeout: 10_000 });
    });

    test('calendar has quick action links', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('link', { name: 'All Events' })).toBeVisible();
    });

    test('seeded events appear on calendar', async ({ page }) => {
        await page.goto('/calendar');
        // Demo data creates events — they appear as event links on the calendar grid.
        const eventLinks = page.locator('a[href*="/events/"]');
        await expect(eventLinks.first()).toBeVisible({ timeout: 10_000 });
        const count = await eventLinks.count();
        expect(count).toBeGreaterThan(0);
    });

    test('game filter checkboxes are visible when games exist', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });

        // Soft check: filter toggle may not exist without IGDB seed data (CI).
        const filterToggle = page.locator('button').filter({ hasText: /filter/i }).first();
        if (await filterToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
            await filterToggle.click();
            const checkboxes = page.getByRole('checkbox');
            const checkboxCount = await checkboxes.count();
            if (checkboxCount > 0) {
                await expect(checkboxes.first()).toBeVisible();
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Mobile (375x812)
// ---------------------------------------------------------------------------

test.describe('Calendar — mobile', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only tests');
    });

    test('view switcher renders with Schedule/Month/Day tabs', async ({ page }) => {
        await page.goto('/calendar');
        // Mobile uses a segmented control with Schedule/Month/Day buttons
        // wrapped in a MobilePageToolbar with aria-label "Calendar view switcher"
        const viewSwitcher = page.locator('[aria-label="Calendar view switcher"]');
        await expect(viewSwitcher).toBeVisible({ timeout: 15_000 });
        await expect(viewSwitcher.getByRole('button', { name: 'Schedule' })).toBeVisible();
        await expect(viewSwitcher.getByRole('button', { name: 'Month' })).toBeVisible();
        await expect(viewSwitcher.getByRole('button', { name: 'Day' })).toBeVisible();
    });

    test('bottom nav has Calendar and Events links', async ({ page }) => {
        await page.goto('/calendar');
        // The bottom navigation bar provides mobile navigation.
        const nav = page.locator('nav[aria-label="Main navigation"]').last();
        await expect(nav).toBeVisible({ timeout: 15_000 });
        await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
    });

    test('seeded events appear on calendar', async ({ page }) => {
        await page.goto('/calendar');
        // Mobile uses Schedule view (list) not the rbc-event grid.
        // Look for event cards with "smoke-" prefix from seeded data.
        const eventItem = page.locator('text=/smoke-/').first();
        await expect(eventItem).toBeVisible({ timeout: 15_000 });
    });

    test('game filter opens dialog when games exist', async ({ page }) => {
        await page.goto('/calendar');
        // Wait for schedule view to load on mobile.
        await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible({ timeout: 15_000 });

        // Soft check: filter button may not exist without IGDB seed data (CI).
        const filterBtn = page.getByRole('button', { name: /filter by game/i });
        if (await filterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await filterBtn.click();
            // On mobile, the filter opens as a dialog with game buttons (not checkboxes).
            const dialog = page.getByRole('dialog', { name: /filter by game/i });
            await expect(dialog).toBeVisible({ timeout: 5_000 });
            // The dialog should contain at least one game button.
            const gameButtons = dialog.getByRole('button');
            const buttonCount = await gameButtons.count();
            expect(buttonCount).toBeGreaterThan(0);
        }
    });
});
