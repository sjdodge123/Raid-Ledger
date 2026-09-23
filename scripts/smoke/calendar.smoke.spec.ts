/**
 * Calendar smoke tests — month view, quick actions, events, and filters.
 * Desktop and mobile viewports.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPatch, apiPost, getAdminToken } from './api-helpers';
import { isDesktop, isMobile, isPhoneLayout } from './helpers';

// ---------------------------------------------------------------------------
// ROK-1662 — the game filter is the one Filters entry: the toolbar funnel +
// inline panel at 1024px and up, the Filters FAB + bottom sheet below.
// ---------------------------------------------------------------------------

interface ConfiguredGame { id: number; slug: string; name: string }

/**
 * HARD precondition: the smoke seed configures games (scheduling-poll fixtures
 * throw without one), and the Filters entry renders as soon as the registry
 * reports a game — so a missing entry is a failure, never a skip.
 */
async function configuredGames(): Promise<ConfiguredGame[]> {
    const body = (await apiGet(await getAdminToken(), '/games/configured')) as { data?: ConfiguredGame[] };
    const games = body.data ?? [];
    expect(games.length, 'GET /games/configured must return the seeded games').toBeGreaterThan(0);
    return games;
}

/** The saved calendar filter back to "every game" (an empty saved list resolves to all). */
async function resetSavedGameFilter(): Promise<void> {
    await apiPatch(await getAdminToken(), '/users/me/preferences', { preferences: { calendarGameFilter: [] } });
}

const gamesHidden = (n: number): string => `${n} ${n === 1 ? 'game' : 'games'} hidden`;

/** The filter body's "N of M selected" line → M (every game the filter knows). */
async function knownGameCount(filters: Locator): Promise<number> {
    const summary = filters.getByText(/^\d+ of \d+ selected$/);
    await expect(summary).toBeVisible();
    const match = /of (\d+) selected/.exec((await summary.textContent()) ?? '');
    expect(match, 'selection summary reads "N of M selected"').not.toBeNull();
    return Number(match?.[1]);
}

/** Desktop: the toolbar funnel, opened; returns the inline panel. */
async function openFilterPanel(page: Page): Promise<Locator> {
    const funnel = page.getByTestId('filter-panel-trigger');
    await expect(funnel).toBeVisible({ timeout: 15_000 });
    await expect(funnel).toHaveAccessibleName('Filters');
    await funnel.click();
    await expect(funnel).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByTestId('filter-panel');
    await expect(panel.getByRole('heading', { name: 'Filters' })).toBeVisible();
    return panel;
}

/** Below 1024px: the Filters FAB, opened; returns the bottom sheet. */
async function openFilterSheet(page: Page): Promise<Locator> {
    const fab = page.getByTestId('filter-fab');
    await expect(fab).toBeVisible({ timeout: 15_000 });
    await expect(fab).toHaveAccessibleName('Filters');
    await fab.click();
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    return sheet;
}

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe('Calendar — desktop', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(isPhoneLayout(testInfo), 'Desktop-only tests');
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

    test('toolbar funnel opens the Filters panel: search, None, a checkbox per game (ROK-1662)', async ({ page }) => {
        const [game] = await configuredGames();
        await page.goto('/calendar');
        const funnel = page.getByTestId('filter-panel-trigger');
        await expect(funnel).toBeVisible({ timeout: 15_000 });
        await expect(funnel).toHaveAttribute('aria-expanded', 'false');
        // Desktop has no FAB and no retired "Filter by game" chip.
        await expect(page.getByTestId('filter-fab')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /filter by game/i })).toHaveCount(0);

        const panel = await openFilterPanel(page);
        await expect(panel.getByRole('searchbox', { name: 'Search games' })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'None' })).toBeVisible();
        await expect(panel.getByRole('checkbox', { name: game.name, exact: true })).toBeVisible();
        expect(await knownGameCount(panel)).toBeGreaterThanOrEqual(1);

        // The funnel toggles the panel shut again.
        await funnel.click();
        await expect(funnel).toHaveAttribute('aria-expanded', 'false');
    });

    test('unticking a game badges the funnel with the hidden count; Clear all resets it (ROK-1662)', async ({ page }) => {
        const [game] = await configuredGames();
        await resetSavedGameFilter();
        try {
            await page.goto('/calendar');
            const funnel = page.getByTestId('filter-panel-trigger');
            await expect(funnel).toBeVisible({ timeout: 15_000 });
            const badge = funnel.getByTestId('filter-count-badge');
            // Every game shown → no badge, no "Clear all".
            await expect(badge).toHaveCount(0);

            const panel = await openFilterPanel(page);
            await expect(panel.getByRole('button', { name: 'Clear all' })).toHaveCount(0);
            const row = panel.getByRole('checkbox', { name: game.name, exact: true });
            await expect(row).toBeChecked();
            await row.click();
            await expect(row).not.toBeChecked();

            await expect(badge).toHaveText('1');
            await expect(funnel).toHaveAccessibleDescription(gamesHidden(1));

            await panel.getByRole('button', { name: 'Clear all' }).click();
            await expect(badge).toHaveCount(0);
            await expect(row).toBeChecked();
            await expect(panel.getByRole('button', { name: 'Clear all' })).toHaveCount(0);
        } finally {
            await resetSavedGameFilter();
        }
    });

    test('Schedule view widened past 1024px still has the funnel + panel (ROK-1662)', async ({ page }) => {
        await configuredGames();
        // Phones open on Schedule; widening keeps it — the funnel must follow.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/calendar');
        await expect(page.getByTestId('filter-fab')).toBeVisible({ timeout: 15_000 });
        await page.setViewportSize({ width: 1280, height: 800 });

        // Still Schedule (no Month/Week/Day toolbar), and the FAB is gone at 1024px and up.
        await expect(page.getByRole('group', { name: 'Calendar view' })).toHaveCount(0);
        await expect(page.getByTestId('filter-fab')).toHaveCount(0);
        const panel = await openFilterPanel(page);
        await expect(panel.getByRole('searchbox', { name: 'Search games' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Mobile (375x812)
// ---------------------------------------------------------------------------

test.describe('Calendar — mobile', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(!isMobile(testInfo), 'Mobile-only tests');
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
});

// ---------------------------------------------------------------------------
// Below 1024px (phone + tablet): the Filters FAB
// ---------------------------------------------------------------------------

test.describe('Calendar — Filters FAB (phone + tablet)', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(isDesktop(testInfo), 'Below 1024px only — desktop uses the toolbar funnel');
    });

    test('Filters FAB opens the sheet with the game search and a row per game (ROK-1662)', async ({ page }) => {
        const [game] = await configuredGames();
        await page.goto('/calendar');
        const sheet = await openFilterSheet(page);
        // No toolbar funnel below 1024px, and the retired "Filter by game" button is gone.
        await expect(page.getByTestId('filter-panel-trigger')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /filter by game/i })).toHaveCount(0);

        const search = sheet.getByRole('searchbox', { name: 'Search games' });
        await expect(search).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'None' })).toBeVisible();
        expect(await knownGameCount(sheet)).toBeGreaterThanOrEqual(1);
        const rows = sheet.locator('button[aria-pressed]');
        const row = rows.filter({ hasText: game.name }).first();
        await expect(row).toBeVisible();

        // The search narrows the list — to nothing, then back to the game.
        await search.fill('zz-no-such-game-rok-1662');
        await expect(sheet.getByText('No games match your search.')).toBeVisible();
        await expect(rows).toHaveCount(0);
        await search.fill(game.name);
        await expect(row).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-1315 — calendar shows gameless events when the game filter is active
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-1315 — calendar shows gameless events when the game filter is active', () => {
    test.beforeEach(({}, testInfo) => {
        // Phones open on the Schedule list (no Week grid). Desktop drives the
        // toolbar funnel; the tablet (Week grid at 768px+) drives the Filters FAB.
        test.skip(isMobile(testInfo), 'Needs the Week grid (768px and up)');
    });

    test('gameless event remains visible after the user picks "None"', async ({ page, world }, testInfo) => {
        await configuredGames();
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

            // The user's last viewPref (persisted) could be Day — narrow to Week
            // so the assertion is deterministic across stored prefs.
            await page.getByRole('button', { name: 'Week', exact: true }).click();

            // The week starts on SUNDAY (`weekStartsOn: 0`). A run late on a
            // Saturday seeds "now + 2h" into next week's Sunday, which the
            // current week never renders — every Saturday-night CI run failed
            // here (2026-08-29 22:59Z, 2026-09-05 22:42Z). Follow the event.
            const sundayOf = (d: Date): number => {
                const x = new Date(d);
                x.setUTCHours(0, 0, 0, 0);
                x.setUTCDate(x.getUTCDate() - x.getUTCDay());
                return x.getTime();
            };
            if (sundayOf(new Date(start)) > sundayOf(new Date())) {
                await page.getByRole('button', { name: /^Next week$/i }).click();
            }

            // Grid events render as <div class="week-event-block"> (WeekEventCard),
            // not links — locate by the unique (world.uid) title.
            const eventCard = page.locator('.week-event-block').filter({ hasText: title }).first();
            await expect(eventCard).toBeVisible({ timeout: 15_000 });

            // Drive the filter into the defined-but-empty state ("None").
            const desktop = isDesktop(testInfo);
            const filters = desktop ? await openFilterPanel(page) : await openFilterSheet(page);
            await filters.getByRole('button', { name: 'None' }).click();
            await expect(filters.getByText(/^0 of \d+ selected$/)).toBeVisible();
            const total = await knownGameCount(filters);

            // Close the filter so the grid is in the foreground.
            const opener = page.getByTestId(desktop ? 'filter-panel-trigger' : 'filter-fab');
            if (desktop) {
                await opener.click();
                await expect(opener).toHaveAttribute('aria-expanded', 'false');
            } else {
                await filters.getByRole('button', { name: 'Close', exact: true }).click();
                await expect(filters).toBeHidden({ timeout: 5_000 });
            }

            // The badge counts every game hidden — the store is in the
            // defined-but-empty state that triggered the ROK-1315 bug pre-fix.
            await expect(opener.getByTestId('filter-count-badge')).toHaveText(String(total));
            await expect(opener).toHaveAccessibleDescription(gamesHidden(total));

            // AC: the gameless event is STILL on the grid. Pre-fix the predicate
            // short-circuited on `event.game?.slug` being falsy.
            await expect(eventCard).toBeVisible({ timeout: 5_000 });
        } finally {
            await apiDelete(token, `/events/${event.id}`);
            await resetSavedGameFilter();
        }
    });
});
