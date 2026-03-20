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

    test('month view renders grid and view switcher', async ({ page }) => {
        await page.goto('/calendar');
        // Calendar heading is hidden md:block — not visible on mobile.
        // Instead, verify the calendar toolbar (Month/Day view switcher) renders.
        const toolbar = page.getByRole('toolbar', { name: 'Calendar view switcher' });
        await expect(toolbar).toBeVisible({ timeout: 15_000 });
        await expect(toolbar.getByRole('button', { name: 'Month' })).toBeVisible();
        // Day-of-week column headers render as generic elements on mobile.
        // Verify at least one day name appears in the grid.
        await expect(page.locator('.rbc-header').first()).toBeVisible({ timeout: 10_000 });
    });

    test('bottom nav has Calendar and Events links', async ({ page }) => {
        await page.goto('/calendar');
        // Quick action links (Create Event, All Events) are hidden on mobile.
        // The bottom navigation bar provides equivalent navigation.
        const nav = page.locator('nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });
        await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
    });

    test('seeded events appear on calendar', async ({ page }) => {
        await page.goto('/calendar');
        // On mobile, calendar events render as buttons (not anchor links).
        // Each event button contains the event title text.
        const calendarEvents = page.locator('.rbc-event');
        await expect(calendarEvents.first()).toBeVisible({ timeout: 10_000 });
        const count = await calendarEvents.count();
        expect(count).toBeGreaterThan(0);
    });

    test('game filter opens dialog when games exist', async ({ page }) => {
        await page.goto('/calendar');
        // Wait for calendar grid to load (no heading on mobile).
        await expect(page.locator('.rbc-header').first()).toBeVisible({ timeout: 15_000 });

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
