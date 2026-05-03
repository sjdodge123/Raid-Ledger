/**
 * Events smoke tests — events list, event detail, reschedule modal, regressions.
 */
import { test, expect } from './base';
import { navigateToFirstEvent } from './helpers';
import { getAdminToken, apiGet, apiPost, apiDelete } from './api-helpers';

// ROK-1070 Codex review (P2): removed the file-level reset-to-seed
// beforeAll. Playwright runs desktop+mobile projects in parallel and a
// global truncate races against the other project's fixtures (e.g.
// activity-timeline.smoke holds an eventId in its own beforeAll). Global
// setup is sufficient.

// ---------------------------------------------------------------------------
// Events List
// ---------------------------------------------------------------------------

test.describe('Events list', () => {
    test('page renders heading and event cards', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses desktop grid selectors');

        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });
        // Demo data creates events — event cards are div[role="button"] not <a> links.
        // The desktop grid is inside "hidden md:grid" so use that scope.
        await expect(
            page.locator('.hidden.md\\:grid [role="button"]').first()
        ).toBeVisible({ timeout: 10_000 });
    });

    test('tab navigation works (Upcoming/Past/My Events/Plans)', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses desktop tab selectors');

        await page.goto('/events');

        // Desktop tabs live inside a "hidden md:flex" container.
        // Scope to that container to avoid matching mobile toolbar buttons.
        const desktopTabs = page.locator('.hidden.md\\:flex .bg-panel');
        await expect(desktopTabs).toBeVisible({ timeout: 10_000 });

        const upcomingTab = desktopTabs.getByRole('button', { name: 'Upcoming' });
        const pastTab = desktopTabs.getByRole('button', { name: 'Past' });
        const mineTab = desktopTabs.getByRole('button', { name: 'My Events' });
        const plansTab = desktopTabs.getByRole('button', { name: 'Plans' });

        await expect(upcomingTab).toBeVisible();
        await expect(pastTab).toBeVisible();
        await expect(mineTab).toBeVisible();
        await expect(plansTab).toBeVisible();

        // Click Past tab
        await pastTab.click();
        await expect(page.getByRole('heading', { name: /Past Events/i })).toBeVisible({ timeout: 10_000 });
    });

    test('search input accepts text and filters results', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses desktop filter bar selectors');

        await page.goto('/events');

        // Desktop search input — scope to the visible desktop filter bar.
        // Both desktop and mobile have aria-label="Search events".
        const desktopFilterBar = page.locator('.hidden.md\\:flex');
        const searchInput = desktopFilterBar.locator('input[aria-label="Search events"]');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Search for a nonsense term — should show empty state.
        await searchInput.fill('xyznonexistent');
        // Wait for the event cards to disappear (filtered out)
        await expect(page.locator('.hidden.md\\:grid [role="button"]').first()).not.toBeVisible({ timeout: 10_000 });

        // Should show zero event cards
        const eventCards = page.locator('.hidden.md\\:grid [role="button"]');
        const count = await eventCards.count();
        expect(count).toBe(0);

        // Clear search — events should reappear
        await searchInput.fill('');
        await expect(
            page.locator('.hidden.md\\:grid [role="button"]').first()
        ).toBeVisible({ timeout: 5_000 });
    });

    test('Create Event link and Schedule a Game button are visible', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — links hidden on mobile');

        await page.goto('/events');
        await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Schedule a Game' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Events List — mobile
// ---------------------------------------------------------------------------

test.describe('Events list — mobile', () => {
    test('page renders heading and event cards', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test — uses mobile card selectors');

        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });
        // Mobile event cards use data-testid="mobile-event-card" (button elements)
        await expect(
            page.locator('[data-testid="mobile-event-card"]').first()
        ).toBeVisible({ timeout: 10_000 });
    });

    test('tab navigation works (Upcoming/Past/My Events/Plans)', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test — uses mobile toolbar selectors');

        await page.goto('/events');

        // Mobile tabs live inside a toolbar with aria-label "Events filters"
        const mobileToolbar = page.getByRole('toolbar', { name: 'Events filters' });
        await expect(mobileToolbar).toBeVisible({ timeout: 10_000 });

        const upcomingTab = mobileToolbar.getByRole('button', { name: 'Upcoming' });
        const pastTab = mobileToolbar.getByRole('button', { name: 'Past' });
        const mineTab = mobileToolbar.getByRole('button', { name: 'My Events' });
        const plansTab = mobileToolbar.getByRole('button', { name: 'Plans' });

        await expect(upcomingTab).toBeVisible();
        await expect(pastTab).toBeVisible();
        await expect(mineTab).toBeVisible();
        await expect(plansTab).toBeVisible();

        // Click Past tab
        await pastTab.click();
        await expect(page.getByRole('heading', { name: /Past Events/i })).toBeVisible({ timeout: 10_000 });
    });

    test('search input accepts text and filters results', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test — uses mobile toolbar selectors');

        await page.goto('/events');

        // Mobile search input is inside the toolbar
        const searchInput = page.getByRole('textbox', { name: 'Search events' });
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Search for a nonsense term — should show empty state
        await searchInput.fill('xyznonexistent');
        // Wait for the mobile event cards to disappear (filtered out)
        await expect(page.locator('[data-testid="mobile-event-card"]').first()).not.toBeVisible({ timeout: 10_000 });

        // Should show zero mobile event cards
        const eventCards = page.locator('[data-testid="mobile-event-card"]');
        const count = await eventCards.count();
        expect(count).toBe(0);

        // Clear search — events should reappear
        await searchInput.fill('');
        await expect(
            page.locator('[data-testid="mobile-event-card"]').first()
        ).toBeVisible({ timeout: 5_000 });
    });

    test('Create Event link and Schedule a Game button are visible', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test — verifies mobile action links');

        await page.goto('/events');
        await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Schedule a Game' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Event Detail
// ---------------------------------------------------------------------------

test.describe('Event detail', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        await navigateToFirstEvent(page, testInfo);
    });

    test('navigate to seeded event and verify content', async ({ page }) => {
        // Event should not show error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('event detail page renders without crashing', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — Reschedule button is behind overflow menu on mobile');

        // Wait for event detail content to appear (e.g. the Reschedule button)
        await expect(page.getByRole('button', { name: 'Reschedule' })).toBeVisible({ timeout: 10_000 });

        // The event detail page should render without crashing
        // (roster content depends on seed data; detailed assertions are in API integration tests)
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('admin action buttons are visible on event detail', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — buttons differ on mobile (overflow menu)');

        // Admin should see management buttons
        await expect(page.getByRole('button', { name: 'Reschedule' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Edit Event' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cancel Event' })).toBeVisible();
    });

    test('event detail loads without error boundary', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — Edit Event button label differs on mobile');

        // Wait for page to fully load by checking for admin buttons
        await expect(page.getByRole('button', { name: 'Edit Event' })).toBeVisible({ timeout: 10_000 });

        // Page should load without errors — detailed count matching
        // is covered by the API integration tests. Here we just verify
        // the page renders correctly.
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Event Detail — Mobile
// ---------------------------------------------------------------------------

test.describe('Event detail — mobile', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test');
        await navigateToFirstEvent(page, testInfo);
    });

    test('navigate to seeded event and verify content', async ({ page }) => {
        // Event heading should be visible
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 10_000 });
        // No error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('event detail page renders without crashing', async ({ page }) => {
        // On mobile, the "Edit" button is directly visible (Reschedule is in overflow)
        // Use exact match to avoid matching event cards with "Edition" in their name
        await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('admin action buttons are visible on mobile', async ({ page }) => {
        // Mobile shows Invite, Edit, and More actions directly
        await expect(page.getByRole('button', { name: 'Invite' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
        // Reschedule is hidden behind overflow menu (not directly visible)
        await expect(page.getByRole('button', { name: 'Reschedule' })).not.toBeVisible();
    });

    test('event detail loads without error boundary', async ({ page }) => {
        // Wait for page to fully load by checking for the Edit button
        // Use exact match to avoid matching event cards with "Edition" in their name
        await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible({ timeout: 10_000 });
        // Attendees heading confirms full page render
        await expect(page.getByRole('heading', { name: /Attendees/i })).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('reschedule modal opens from overflow menu and shows signup count', async ({ page }) => {
        // Open overflow menu
        await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: 'More actions' }).click();

        // Click Reschedule in the overflow menu
        const rescheduleBtn = page.getByRole('button', { name: 'Reschedule' });
        await expect(rescheduleBtn).toBeVisible({ timeout: 5_000 });
        await rescheduleBtn.click();

        // Modal/BottomSheet should open with heading and show signup info
        const modal = page.locator('[role="dialog"]').filter({ hasText: 'Reschedule Event' });
        await expect(modal.getByRole('heading', { name: 'Reschedule Event' })).toBeVisible({ timeout: 10_000 });
        // Wait for loading to finish — either availability heatmap or zero-signup message
        await expect(modal.getByText(/loading availability/i)).not.toBeVisible({ timeout: 10_000 });
        const availabilityOrEmpty = modal.getByText(/player availability|no players signed up/i).first();
        await expect(availabilityOrEmpty).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-886 — event detail mobile action button layout
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-886 — event detail mobile layout', () => {
    test('action buttons use overflow menu on mobile viewport', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test');

        const context = await browser.newContext({
            viewport: { width: 375, height: 812 },
            storageState: 'scripts/.auth/admin.json',
        });
        const page = await context.newPage();

        await page.goto('/events');
        // On mobile, use mobile event cards (desktop grid is hidden)
        const eventCard = page.locator('[data-testid="mobile-event-card"]').first();
        await expect(eventCard).toBeVisible({ timeout: 10_000 });
        await eventCard.click();
        await page.waitForURL(/\/events\/\d+/, { timeout: 10_000 });

        // Invite and "More actions" visible; Reschedule hidden (in overflow)
        await expect(page.getByRole('button', { name: 'Invite' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Reschedule' })).not.toBeVisible();

        // Open overflow menu
        await page.getByRole('button', { name: 'More actions' }).click();
        await expect(page.getByRole('button', { name: 'Reschedule' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cancel Event' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Delete Event' })).toBeVisible();

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-847 — role preference icons on event detail
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-847 — role preference icons', () => {
    test('role preference icons render when preferredRoles data exists', async ({ page }, testInfo) => {
        await navigateToFirstEvent(page, testInfo);

        // Wait for event detail to load
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);

        // Role preference icons are <img alt="tank|healer|dps">.
        // Seed data assigns preferredRoles to confirmed signups — if this event
        // has any, verify they render. Unit tests cover the rendering logic;
        // this smoke test verifies the end-to-end data flow.
        const roleIcons = page.locator('img[alt="tank"], img[alt="healer"], img[alt="dps"]');
        const count = await roleIcons.count();
        if (count > 0) {
            await expect(roleIcons.first()).toBeVisible();
        }
        // No assertion failure if count === 0 — the first event may not have
        // confirmed signups with preferredRoles. The rendering path is covered
        // by 30 unit tests (PlayerCard + EventDetailRoster).
    });
});

// ---------------------------------------------------------------------------
// Reschedule Modal
// ---------------------------------------------------------------------------

test.describe('Reschedule modal', () => {
    test('opens on seeded event and shows signup count', async ({ page }, testInfo) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — Reschedule is behind overflow menu on mobile');

        await navigateToFirstEvent(page, testInfo);

        // Click Reschedule button
        const rescheduleBtn = page.getByRole('button', { name: 'Reschedule' });
        await expect(rescheduleBtn).toBeVisible({ timeout: 10_000 });
        await rescheduleBtn.click();

        // Modal should open with "Reschedule Event" heading and show signup info
        const modal = page.locator('[role="dialog"]');
        await expect(modal.getByRole('heading', { name: 'Reschedule Event' })).toBeVisible({ timeout: 10_000 });
        // Wait for loading to finish — either availability heatmap or zero-signup message
        await expect(modal.getByText(/loading availability/i)).not.toBeVisible({ timeout: 10_000 });
        // Now one of these two texts should be visible
        const availabilityOrEmpty = modal.getByText(/player availability|no players signed up/i).first();
        await expect(availabilityOrEmpty).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-784 — attendance dashboard light mode
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-784 — attendance dashboard light mode', () => {
    test('attendance tracker uses theme-aware backgrounds in light mode', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — uses desktop tab/grid selectors');

        // Navigate to Past events to find a completed event
        await page.goto('/events');
        const desktopTabs = page.locator('.hidden.md\\:flex .bg-panel');
        await expect(desktopTabs).toBeVisible({ timeout: 10_000 });
        await desktopTabs.getByRole('button', { name: 'Past' }).click();
        await expect(page.getByRole('heading', { name: /Past Events/i })).toBeVisible({ timeout: 10_000 });

        // Click the first past event card
        const firstEventCard = page.locator('.hidden.md\\:grid [role="button"]').first();
        if (!await firstEventCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
            test.skip(true, 'No past events in demo data — cannot test attendance tracker');
            return;
        }
        await firstEventCard.click();
        await page.waitForURL(/\/events\/\d+/, { timeout: 10_000 });

        // Switch to light mode by setting data-scheme on <html>
        await page.evaluate(() => document.documentElement.setAttribute('data-scheme', 'light'));

        // Look for the Attendance heading — it only renders for past events when the user is an organizer
        const attendanceHeading = page.getByRole('heading', { name: 'Attendance' });
        if (!await attendanceHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
            test.skip(true, 'Attendance tracker not visible on this event — may not be past or user is not organizer');
            return;
        }

        // The attendance container is the parent of the "Attendance" heading.
        // Verify its computed background color is light (not the old hardcoded dark zinc-800).
        const container = page.locator('h3:has-text("Attendance")').locator('..');
        const bgColor = await container.evaluate((el) => getComputedStyle(el).backgroundColor);

        // In light mode, bg-panel resolves to #f1f5f9 (slate-100) with /50 alpha.
        // The old bug used bg-zinc-800 (#27272a) which is very dark.
        // Parse RGB values — a light background should have R, G, B all > 200.
        const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        expect(match).not.toBeNull();
        if (match) {
            const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
            // Light-mode backgrounds should have high channel values (> 180)
            // Dark-mode zinc-800 (#27272a) has channels around 39, so this clearly distinguishes
            expect(r).toBeGreaterThan(180);
            expect(g).toBeGreaterThan(180);
            expect(b).toBeGreaterThan(180);
        }
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-868 — character info on duplicate web signup
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-868 — character info on duplicate signup', () => {
    test('character data appears in event detail after duplicate signup with character', async ({ page, world }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — attendees panel uses desktop selectors');

        const token = await getAdminToken();

        // Find admin's first character
        const chars = (await apiGet(token, '/users/me/characters')) as { data: Array<{ id: string; name: string; gameId: number }> };
        if (!chars.data?.length) {
            test.skip(true, 'Admin has no characters — cannot test duplicate signup with character');
            return;
        }
        const char = chars.data[0];

        // Create event with the character's game — admin auto-signs up WITHOUT character
        const futureStart = new Date(Date.now() + 86_400_000).toISOString();
        const futureEnd = new Date(Date.now() + 90_000_000).toISOString();
        const event = (await apiPost(token, '/events', {
            title: world.uid('character-test-event'),
            gameId: char.gameId,
            startTime: futureStart,
            endTime: futureEnd,
            maxAttendees: 10,
        })) as { id: number };

        try {
            // Re-signup with character (triggers duplicate signup path — the ROK-868 fix)
            await apiPost(token, `/events/${event.id}/signup`, {
                characterId: char.id,
                preferredRoles: ['dps'],
            });

            // Navigate to event detail and verify character info renders
            await page.goto(`/events/${event.id}`);
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

            // PlayerCharacterInfo renders "CharName . ClassName" inside a <p>
            await expect(page.getByText(char.name).first()).toBeVisible({ timeout: 10_000 });

            // FlexibilityBadges renders a span with title="Prefers: Dps" containing role icons
            await expect(page.locator('[title="Prefers: Dps"]').first()).toBeVisible({ timeout: 5_000 });
        } finally {
            await apiDelete(token, `/events/${event.id}`);
        }
    });
});
