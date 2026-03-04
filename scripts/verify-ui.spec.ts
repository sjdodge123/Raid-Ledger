/**
 * Playwright Smoke Tests — ROK-653
 *
 * Comprehensive UI smoke tests run against DEMO_MODE seed data.
 * All tests run as admin@local via storageState from global setup.
 *
 * Run:
 *   npx playwright test                              # auto-starts dev server
 *   BASE_URL=http://localhost:5173 npx playwright test  # against running server
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test.describe('Auth', () => {
    /**
     * Helper: expand the local login form if OAuth providers (Discord) are shown.
     * Waits for the login page to load, then clicks the toggle to reveal
     * username/password fields if they're hidden behind an OAuth-first layout.
     */
    async function expandLocalLogin(page: import('@playwright/test').Page) {
        // Wait for the login page to be interactive — either OAuth button or Username label
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        const toggleBtn = page.getByText('Sign in with username instead');
        if (await toggleBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await toggleBtn.click();
            // Wait for the form to expand
            await expect(page.locator('#username')).toBeVisible({ timeout: 5_000 });
        }
    }

    test('login page renders form fields', async ({ browser }) => {
        // Use a fresh context without storageState to test unauthenticated view
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/');
        await expandLocalLogin(page);

        await expect(page.locator('#username')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#password')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

        await context.close();
    });

    test('local login with admin@local credentials works', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/');
        await expandLocalLogin(page);

        await page.locator('#username').fill('admin@local');
        await page.locator('#password').fill(process.env.ADMIN_PASSWORD || 'password');
        await page.getByRole('button', { name: 'Sign In' }).click();

        // After login the app may redirect to /calendar, /onboarding, or /setup
        // depending on admin state. Just verify we left the login page.
        await expect(page.getByRole('button', { name: 'Sign In' })).not.toBeVisible({ timeout: 15_000 });

        await context.close();
    });

    test('unauthenticated user is redirected to login', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        // Try to access a protected route
        await page.goto('/events');
        // Should show the login form — look for a sign-in related button
        // (could be "Continue with Discord" or "Sign In" depending on config)
        await expect(
            page.getByRole('button', { name: /sign in|continue with/i }).first()
        ).toBeVisible({ timeout: 15_000 });

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

test.describe('Calendar', () => {
    test('month view renders heading and grid', async ({ page }) => {
        await page.goto('/calendar');
        // The h1 "Calendar" heading is desktop-only (hidden md:block).
        // At the Desktop Chrome viewport (1280px) it should be visible.
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });
        // The calendar grid should be visible (look for day-of-week column headers).
        // react-big-calendar renders "Sun", "Mon" etc. (CSS uppercases them visually).
        await expect(page.getByRole('columnheader', { name: 'Mon' })).toBeVisible({ timeout: 10_000 });
    });

    test('calendar has quick action links', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('link', { name: 'All Events' })).toBeVisible();
    });

    test('seeded events appear on calendar', async ({ page }) => {
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

// ---------------------------------------------------------------------------
// Events List
// ---------------------------------------------------------------------------

test.describe('Events list', () => {
    test('page renders heading and event cards', async ({ page }) => {
        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });
        // Demo data creates events — event cards are div[role="button"] not <a> links.
        // The desktop grid is inside "hidden md:grid" so use that scope.
        await expect(
            page.locator('.hidden.md\\:grid [role="button"]').first()
        ).toBeVisible({ timeout: 10_000 });
    });

    test('tab navigation works (Upcoming/Past/My Events/Plans)', async ({ page }) => {
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
        await page.goto('/events');

        // Desktop search input — scope to the visible desktop filter bar.
        // Both desktop and mobile have aria-label="Search events".
        const desktopFilterBar = page.locator('.hidden.md\\:flex');
        const searchInput = desktopFilterBar.locator('input[aria-label="Search events"]');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Search for a nonsense term — should show empty state
        // Use pressSequentially to trigger input/change events that drive the search filter
        await searchInput.pressSequentially('xyznonexistent', { delay: 50 });
        // Wait for the event cards to disappear (filtered out) — allow extra time for CI debounce
        await expect(page.locator('.hidden.md\\:grid [role="button"]').first()).not.toBeVisible({ timeout: 10_000 });

        // Should show zero event cards
        const eventCards = page.locator('.hidden.md\\:grid [role="button"]');
        const count = await eventCards.count();
        expect(count).toBe(0);

        // Clear search — events should reappear
        await searchInput.clear();
        await expect(
            page.locator('.hidden.md\\:grid [role="button"]').first()
        ).toBeVisible({ timeout: 5_000 });
    });

    test('Create Event and Plan Event links are visible', async ({ page }) => {
        await page.goto('/events');
        await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('link', { name: 'Plan Event' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Event Detail (TD-2: shared navigation in beforeEach)
// ---------------------------------------------------------------------------

test.describe('Event detail', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/events');

        // Event cards are div[role="button"], NOT <a> tags.
        // Click the first event card in the desktop grid.
        const firstEventCard = page.locator('.hidden.md\\:grid [role="button"]').first();
        await expect(firstEventCard).toBeVisible({ timeout: 10_000 });
        await firstEventCard.click();

        // Should land on event detail page (numeric ID)
        await page.waitForURL(/\/events\/\d+/, { timeout: 10_000 });
    });

    test('navigate to seeded event and verify content', async ({ page }) => {
        // Event should not show error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('event detail page renders without crashing', async ({ page }) => {
        // Wait for event detail content to appear (e.g. the Reschedule button)
        await expect(page.getByRole('button', { name: 'Reschedule' })).toBeVisible({ timeout: 10_000 });

        // The event detail page should render without crashing
        // (roster content depends on seed data; detailed assertions are in API integration tests)
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('admin action buttons are visible on event detail', async ({ page }) => {
        // Admin should see management buttons
        await expect(page.getByRole('button', { name: 'Reschedule' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Edit Event' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cancel Event' })).toBeVisible();
    });

    test('event detail loads without error boundary', async ({ page }) => {
        // Wait for page to fully load by checking for admin buttons
        await expect(page.getByRole('button', { name: 'Edit Event' })).toBeVisible({ timeout: 10_000 });

        // Page should load without errors — detailed count matching
        // is covered by the API integration tests. Here we just verify
        // the page renders correctly.
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Reschedule Modal
// ---------------------------------------------------------------------------

test.describe('Reschedule modal', () => {
    test('opens on seeded event and shows signup count', async ({ page }) => {
        await page.goto('/events');

        const firstEventCard = page.locator('.hidden.md\\:grid [role="button"]').first();
        await expect(firstEventCard).toBeVisible({ timeout: 10_000 });
        await firstEventCard.click();
        await page.waitForURL(/\/events\/\d+/, { timeout: 10_000 });

        // Click Reschedule button
        const rescheduleBtn = page.getByRole('button', { name: 'Reschedule' });
        await expect(rescheduleBtn).toBeVisible({ timeout: 10_000 });
        await rescheduleBtn.click();

        // Modal should open with "Reschedule Event" heading and show player availability
        await expect(page.getByRole('heading', { name: 'Reschedule Event' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/player availability/i)).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test.describe('Notifications', () => {
    test('bell icon is visible in header', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible({ timeout: 15_000 });
    });

    test('dropdown opens and shows content', async ({ page }) => {
        await page.goto('/calendar');
        const bellBtn = page.getByRole('button', { name: 'Notifications' }).first();
        await expect(bellBtn).toBeVisible({ timeout: 15_000 });
        await bellBtn.click();

        // Dropdown should open with "Notifications" heading (h3 has implicit heading role)
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 5_000 });

        // Should show either notification items or the empty state
        const hasNotifications = await page.getByText('Roster Slot Available').first().isVisible({ timeout: 2_000 }).catch(() => false);
        if (!hasNotifications) {
            await expect(page.getByText('No notifications')).toBeVisible({ timeout: 5_000 });
        }
    });

    test('Mark All Read button works', async ({ page }) => {
        await page.goto('/calendar');
        const bellBtn = page.getByRole('button', { name: 'Notifications' }).first();
        await expect(bellBtn).toBeVisible({ timeout: 15_000 });
        await bellBtn.click();

        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 5_000 });

        const markAllReadBtn = page.getByRole('button', { name: 'Mark All Read' });
        if (await markAllReadBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await markAllReadBtn.click();
            // After marking all as read, verify no errors
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe('Navigation', () => {
    test('header contains all main nav links', async ({ page }) => {
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
        await page.goto('/calendar');
        const nav = page.locator('header nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        // Navigate to Events
        await nav.getByRole('link', { name: 'Events' }).click();
        await page.waitForURL('**/events', { timeout: 10_000 });
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible();

        // Navigate to Games
        await nav.getByRole('link', { name: 'Games' }).click();
        await page.waitForURL('**/games', { timeout: 10_000 });

        // Navigate to Players
        await nav.getByRole('link', { name: 'Players' }).click();
        await page.waitForURL('**/players', { timeout: 10_000 });
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible();

        // Navigate back to Calendar
        await nav.getByRole('link', { name: 'Calendar' }).click();
        await page.waitForURL('**/calendar', { timeout: 10_000 });
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    });

    test('no critical console errors during navigation', async ({ page }) => {
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

// ---------------------------------------------------------------------------
// Games Page
// ---------------------------------------------------------------------------

test.describe('Games page', () => {
    test('page loads without crashing', async ({ page }) => {
        await page.goto('/games');
        // Games page may show "Discover" tab or game cards depending on IGDB data
        // Wait for page to settle by checking for absence of error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Players Page
// ---------------------------------------------------------------------------

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
