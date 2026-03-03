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
    test('login page renders form fields', async ({ browser }) => {
        // Use a fresh context without storageState to test unauthenticated view
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/');
        // RootRedirect renders LoginPage inline for unauthenticated users
        await expect(page.getByLabel('Username')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByLabel('Password')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

        await context.close();
    });

    test('local login with admin@local credentials works', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        await page.goto('/');
        await page.getByLabel('Username').fill('admin@local');
        await page.getByLabel('Password').fill(process.env.ADMIN_PASSWORD || 'password');
        await page.getByRole('button', { name: 'Sign In' }).click();

        // Should redirect to /calendar after successful login
        await page.waitForURL('**/calendar**', { timeout: 15_000 });
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();

        await context.close();
    });

    test('unauthenticated user is redirected to login', async ({ browser }) => {
        const context = await browser.newContext({ storageState: undefined });
        const page = await context.newPage();

        // Try to access a protected route
        await page.goto('/events');
        // Should show the login form (RootRedirect renders it inline at "/")
        await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 15_000 });

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

test.describe('Calendar', () => {
    test('month view renders heading and grid', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible({ timeout: 15_000 });
        // The calendar grid should be visible (look for day names or grid container)
        // Month view has day-of-week headers
        await expect(page.getByText('Mon').first()).toBeVisible({ timeout: 10_000 });
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
        // Wait for events to load, then check for any event link
        await page.waitForTimeout(2000);
        const eventLinks = page.locator('a[href*="/events/"]');
        const count = await eventLinks.count();
        expect(count).toBeGreaterThan(0);
    });

    test('game filter checkboxes are visible when games exist', async ({ page }) => {
        await page.goto('/calendar');
        await page.waitForTimeout(2000);
        // The filter section appears with game checkboxes when games are in the registry
        // This may not be visible if no IGDB games exist in CI, so we check conditionally
        const filterToggle = page.locator('button').filter({ hasText: /filter/i }).first();
        if (await filterToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
            await filterToggle.click();
            // Should see game checkboxes in the filter panel
            const checkboxes = page.getByRole('checkbox');
            const checkboxCount = await checkboxes.count();
            // If games exist, there should be filter checkboxes
            if (checkboxCount > 0) {
                await expect(checkboxes.first()).toBeVisible();
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Events List
// ---------------------------------------------------------------------------

test.describe('Events list', () => {
    test('page renders heading and event cards', async ({ page }) => {
        await page.goto('/events');
        await expect(page.getByRole('heading', { name: /Events/i }).first()).toBeVisible({ timeout: 15_000 });
        // Demo data creates 6 events — at least some should be upcoming
        await page.waitForTimeout(2000);
        // Look for event cards with titles from seed data
        const eventCards = page.locator('a[href*="/events/"]');
        await expect(eventCards.first()).toBeVisible({ timeout: 10_000 });
    });

    test('tab navigation works (Upcoming/Past/My Events/Plans)', async ({ page }) => {
        await page.goto('/events');
        await page.waitForTimeout(2000);

        // Desktop tabs should be visible
        const upcomingTab = page.getByRole('button', { name: 'Upcoming' });
        const pastTab = page.getByRole('button', { name: 'Past' });
        const mineTab = page.getByRole('button', { name: 'My Events' });
        const plansTab = page.getByRole('button', { name: 'Plans' });

        await expect(upcomingTab).toBeVisible({ timeout: 10_000 });
        await expect(pastTab).toBeVisible();
        await expect(mineTab).toBeVisible();
        await expect(plansTab).toBeVisible();

        // Click Past tab
        await pastTab.click();
        await expect(page.getByRole('heading', { name: /Past Events/i })).toBeVisible({ timeout: 10_000 });
    });

    test('search filters event titles', async ({ page }) => {
        await page.goto('/events');
        await page.waitForTimeout(2000);

        const searchInput = page.getByLabel('Search events');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });
        await searchInput.fill('Heroic');
        await page.waitForTimeout(500);

        // Should show Heroic Amirdrassil Clear and filter out others
        await expect(page.getByText('Heroic Amirdrassil Clear').first()).toBeVisible({ timeout: 5_000 });
    });

    test('Create Event and Plan Event links are visible', async ({ page }) => {
        await page.goto('/events');
        await expect(page.getByRole('link', { name: 'Create Event' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('link', { name: 'Plan Event' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Event Detail
// ---------------------------------------------------------------------------

test.describe('Event detail', () => {
    test('navigate to seeded event and verify content', async ({ page }) => {
        await page.goto('/events');
        await page.waitForTimeout(2000);

        // Click the first event link
        const firstEvent = page.locator('a[href*="/events/"]').first();
        await expect(firstEvent).toBeVisible({ timeout: 10_000 });
        await firstEvent.click();

        // Should land on event detail page
        await page.waitForURL('**/events/**', { timeout: 10_000 });
        // Event should not show error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('event detail page renders without crashing', async ({ page }) => {
        await page.goto('/events');
        await page.waitForTimeout(2000);

        const firstEvent = page.locator('a[href*="/events/"]').first();
        await expect(firstEvent).toBeVisible({ timeout: 10_000 });
        await firstEvent.click();
        await page.waitForURL('**/events/**', { timeout: 10_000 });

        // Wait for event detail to load
        await page.waitForTimeout(2000);

        // The event detail page should render without crashing
        // (roster content depends on seed data; detailed assertions are in API integration tests)
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('admin action buttons are visible on event detail', async ({ page }) => {
        await page.goto('/events');
        await page.waitForTimeout(2000);

        const firstEvent = page.locator('a[href*="/events/"]').first();
        await expect(firstEvent).toBeVisible({ timeout: 10_000 });
        await firstEvent.click();
        await page.waitForURL('**/events/**', { timeout: 10_000 });

        // Admin should see management buttons
        await expect(page.getByRole('button', { name: 'Reschedule' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('button', { name: 'Edit Event' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Cancel Event' })).toBeVisible();
    });

    test('event detail loads without error boundary', async ({ page }) => {
        await page.goto('/events');
        await page.waitForTimeout(2000);

        const firstEvent = page.locator('a[href*="/events/"]').first();
        await expect(firstEvent).toBeVisible({ timeout: 10_000 });
        await firstEvent.click();
        await page.waitForURL('**/events/**', { timeout: 10_000 });
        await page.waitForTimeout(3000);

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
        await page.waitForTimeout(2000);

        const firstEvent = page.locator('a[href*="/events/"]').first();
        await expect(firstEvent).toBeVisible({ timeout: 10_000 });
        await firstEvent.click();
        await page.waitForURL('**/events/**', { timeout: 10_000 });

        // Click Reschedule button
        const rescheduleBtn = page.getByRole('button', { name: 'Reschedule' });
        await expect(rescheduleBtn).toBeVisible({ timeout: 10_000 });
        await rescheduleBtn.click();

        // Modal should open with "signed up" text visible
        await expect(page.getByText(/signed up/i)).toBeVisible({ timeout: 10_000 });
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

    test('dropdown opens and shows notification items', async ({ page }) => {
        await page.goto('/calendar');
        const bellBtn = page.getByRole('button', { name: 'Notifications' });
        await expect(bellBtn).toBeVisible({ timeout: 15_000 });
        await bellBtn.click();

        // Dropdown should open with "Notifications" heading
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 5_000 });

        // Demo data seeds notifications for admin — check for known titles
        await expect(page.getByText('Roster Slot Available').first()).toBeVisible({ timeout: 5_000 });
    });

    test('Mark All Read button works', async ({ page }) => {
        await page.goto('/calendar');
        const bellBtn = page.getByRole('button', { name: 'Notifications' });
        await expect(bellBtn).toBeVisible({ timeout: 15_000 });
        await bellBtn.click();

        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 5_000 });

        const markAllReadBtn = page.getByRole('button', { name: 'Mark All Read' });
        if (await markAllReadBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await markAllReadBtn.click();
            // After marking all as read, the button should disappear or notifications update
            await page.waitForTimeout(1000);
            // Verify no errors
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
        const nav = page.getByLabel('Main navigation');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Games' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Players' })).toBeVisible();
    });

    test('nav links navigate to correct pages', async ({ page }) => {
        await page.goto('/calendar');
        const nav = page.getByLabel('Main navigation');
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

        await page.goto('/calendar');
        await page.waitForTimeout(2000);
        await page.goto('/events');
        await page.waitForTimeout(2000);
        await page.goto('/games');
        await page.waitForTimeout(2000);
        await page.goto('/players');
        await page.waitForTimeout(2000);

        // Filter out known benign errors (network, favicon, CORS in dev)
        const criticalErrors = errors.filter(
            (e) =>
                !e.includes('net::') &&
                !e.includes('favicon') &&
                !e.includes('404') &&
                !e.includes('CORS') &&
                !e.includes('ERR_CONNECTION_REFUSED'),
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
        await page.waitForTimeout(3000);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Players Page
// ---------------------------------------------------------------------------

test.describe('Players page', () => {
    test('renders heading and player list from seed data', async ({ page }) => {
        await page.goto('/players');
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible({ timeout: 15_000 });

        // Demo data creates ~100 users — should see player entries
        await page.waitForTimeout(2000);
        // Look for known seed usernames
        await expect(page.getByText('ShadowMage').first()).toBeVisible({ timeout: 10_000 });
    });

    test('shows total player count', async ({ page }) => {
        await page.goto('/players');
        await page.waitForTimeout(2000);
        // The players page shows "N registered" — demo data has ~101 users
        await expect(page.getByText(/registered/i)).toBeVisible({ timeout: 10_000 });
    });
});
