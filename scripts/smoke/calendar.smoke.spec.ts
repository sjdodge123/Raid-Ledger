/**
 * Calendar smoke tests — month view, quick actions, events, and filters.
 * Desktop and mobile viewports.
 */
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';

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

    test('filter chip opens dialog (ROK-1305)', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });

        // ROK-1305: the prior sidebar's inline checkbox list + "Show all N games..."
        // overflow button collapsed into a single chip in the desktop sidebar.
        // Soft check: chip is hidden without IGDB seed data (CI may have none).
        const chip = page.getByRole('button', { name: /filter by game/i }).first();
        if (!(await chip.isVisible({ timeout: 3000 }).catch(() => false))) {
            return;
        }
        await expect(chip).toContainText(/Filter:/);

        await chip.click();
        const dialog = page.getByRole('dialog', { name: /filter by game/i });
        await expect(dialog).toBeVisible({ timeout: 5_000 });
        // AC: dialog exposes Select all / Deselect all / search / game list.
        // Modal items wrap visually-hidden <input type="checkbox"> in <label>,
        // so the AX tree drops the input — target the .game-filter-item label.
        await expect(dialog.getByRole('button', { name: 'All' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'None' })).toBeVisible();
        await expect(dialog.getByRole('textbox', { name: /search games/i })).toBeVisible();
        const items = dialog.locator('.game-filter-item');
        const count = await items.count();
        expect(count).toBeGreaterThan(0);
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
        // In CI without seeded smoke events, skip gracefully.
        const eventItem = page.locator('text=/smoke-/').first();
        const hasEvents = await eventItem.isVisible({ timeout: 10_000 }).catch(() => false);
        if (!hasEvents) {
            test.skip(true, 'No smoke-prefixed events seeded — skipping mobile calendar event check');
            return;
        }
        await expect(eventItem).toBeVisible();
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

// ---------------------------------------------------------------------------
// Regression: ROK-1315 — calendar shows gameless events when filter chip active
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-1315 — calendar shows gameless events when filter chip active', () => {
    test.beforeEach(({}, testInfo) => {
        // The filter chip lives in the desktop sidebar. The mobile FAB / sheet
        // flow opens the same modal but the chip element only renders on
        // desktop, so scope this regression to the desktop project.
        test.skip(testInfo.project.name === 'mobile', 'Filter chip is desktop-only');
    });

    test('gameless event remains visible after the user opens the chip and clicks "None"', async ({ page, world }) => {
        const token = await getAdminToken();

        // Create a gameless event (no `gameId`) inside the visible week so it
        // shows on the calendar grid regardless of the user's saved view.
        const start = new Date(Date.now() + 2 * 3600_000).toISOString();
        const end = new Date(Date.now() + 5 * 3600_000).toISOString();
        const title = world.uid('rok-1315-variety-night');
        const event = (await apiPost(token, '/events', {
            title,
            startTime: start,
            endTime: end,
            maxAttendees: 10,
        })) as { id: number };

        try {
            await page.goto('/calendar');
            await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });

            // Make sure the calendar covers the event's start. The week / month
            // ranges already include "now + 2h", but the user's last viewPref
            // (persisted in localStorage) could be Day — narrow to Week so the
            // assertion is deterministic across stored prefs.
            await page.getByRole('button', { name: 'Week' }).click();

            // Pre-condition: the gameless event renders at least once with the
            // chip in its untouched default state. (The chip start state has a
            // defined Set populated by `selectAll` once `allKnownGames` lands —
            // this would have failed on the buggy predicate too, since the bug
            // applies to ANY defined Set, not only the "None" state.)
            const eventLink = page.locator(`a[href*="/events/${event.id}"]`).first();
            await expect(eventLink).toBeVisible({ timeout: 15_000 });

            // Drive the chip into the defined-but-empty state (deselect all).
            // The chip is gated by `allKnownGames.length > 0` — without IGDB
            // seed data the chip never renders, in which case the broken
            // predicate path can't be exercised end-to-end. Skip with a clear
            // message in that case.
            const chip = page.getByRole('button', { name: /filter by game/i }).first();
            if (!(await chip.isVisible({ timeout: 3000 }).catch(() => false))) {
                test.skip(true, 'Filter chip absent — IGDB seed data missing in this env.');
                return;
            }
            await chip.click();
            const dialog = page.getByRole('dialog', { name: /filter by game/i });
            await expect(dialog).toBeVisible({ timeout: 5_000 });
            await dialog.getByRole('button', { name: 'None' }).click();
            // Close the dialog so the calendar grid is in the foreground.
            await page.keyboard.press('Escape');
            await expect(dialog).not.toBeVisible({ timeout: 5_000 });

            // The chip should now read "Filter: No games" — confirms the store
            // has flipped into the defined-but-empty state that triggers the
            // ROK-1315 bug pre-fix.
            await expect(chip).toContainText(/Filter: No games/);

            // AC: gameless event is STILL rendered on the grid even though the
            // filter chip is in a defined non-default state. Pre-fix this
            // assertion fails because the predicate short-circuited on
            // `event.game?.slug` being falsy.
            await expect(eventLink).toBeVisible({ timeout: 5_000 });
        } finally {
            await apiDelete(token, `/events/${event.id}`);
        }
    });
});
