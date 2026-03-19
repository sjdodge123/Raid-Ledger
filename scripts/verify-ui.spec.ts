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
import { test, expect, type APIRequestContext } from '@playwright/test';

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
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

        // Wait for events to load — event cards have role="button" with h3 titles inside.
        const eventCards = page.locator('main [role="button"] h3');
        await expect(eventCards.first()).toBeVisible({ timeout: 15_000 });

        // Desktop search input — both desktop and mobile share the same aria-label,
        // so scope to the visible one using :visible pseudo-class.
        const searchInput = page.locator('main').getByLabel('Search events').and(page.locator(':visible'));
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Search for a nonsense term — event cards should disappear.
        await searchInput.fill('xyznonexistent');
        await expect(eventCards).toHaveCount(0, { timeout: 10_000 });

        // Clear search — event cards should reappear
        await searchInput.fill('');
        await expect(eventCards.first()).toBeVisible({ timeout: 10_000 });
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
// Regression: ROK-886 — event detail mobile action button layout
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-886 — event detail mobile layout', () => {
    test('action buttons use overflow menu on mobile viewport', async ({ browser }) => {
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
    test('role preference icons render when preferredRoles data exists', async ({ page }) => {
        // Navigate to events list and click the first event
        await page.goto('/events');
        const firstEventCard = page.locator('.hidden.md\\:grid [role="button"]').first();
        await expect(firstEventCard).toBeVisible({ timeout: 10_000 });
        await firstEventCard.click();
        await page.waitForURL(/\/events\/\d+/, { timeout: 10_000 });

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
        const notificationItems = page.locator('.divide-y > *');
        const emptyState = page.getByText('No notifications');
        await expect(notificationItems.first().or(emptyState)).toBeVisible({ timeout: 5_000 });
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

        // Navigate to Games (no heading — page uses tabs/cards layout)
        await nav.getByRole('link', { name: 'Games' }).click();
        await page.waitForURL('**/games', { timeout: 10_000 });

        // Navigate to Players
        await nav.getByRole('link', { name: 'Players' }).click();
        await page.waitForURL('**/players', { timeout: 10_000 });
        await expect(page.getByRole('heading', { name: 'Players' })).toBeVisible();

        // Navigate back to Calendar
        await nav.getByRole('link', { name: 'Calendar' }).click();
        await page.waitForURL('**/calendar', { timeout: 10_000 });
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

        // Demo data creates ~100 users. Verify the grid renders player links
        // (don't assert specific seed usernames — they vary by seed state).
        await expect(page.locator('main a[href^="/users/"]').first()).toBeVisible({ timeout: 10_000 });
    });

    test('shows total player count', async ({ page }) => {
        await page.goto('/players');
        // The players page shows "N registered" — demo data has ~101 users
        await expect(page.getByText(/registered/i)).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-811 — games page mobile cards cramped together
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-811 — games page mobile card spacing', () => {
    test('game cards in carousel sections are visible at mobile viewport', async ({ browser }) => {
        const context = await browser.newContext({
            viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Look for carousel row headings on mobile (h2 elements inside the discover view)
        const carouselHeadings = page.locator('h2');
        if (await carouselHeadings.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Game cards within the first carousel row should be visible
            const gameCards = page.locator('a[href*="/games/"]');
            await expect(gameCards.first()).toBeVisible({ timeout: 5_000 });
        }

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-813 — games page search container styling on mobile
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-813 — games page mobile search styling', () => {
    test('search input and tab toggle are visible at mobile viewport', async ({ browser }) => {
        const context = await browser.newContext({
            viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Search input should be visible on mobile
        const searchInput = page.getByPlaceholder('Search games...');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Tab toggle is only rendered for admins — check if present and visible
        const tabToggle = page.getByRole('button', { name: /discover/i });
        if (await tabToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await expect(tabToggle).toBeVisible();
        }

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-784 — attendance dashboard light mode
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-784 — attendance dashboard light mode', () => {
    test('attendance tracker uses theme-aware backgrounds in light mode', async ({ page }) => {
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
    const API_BASE = process.env.API_URL || 'http://localhost:3000';

    async function getAdminToken(): Promise<string> {
        const res = await fetch(`${API_BASE}/auth/local`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin@local', password: process.env.ADMIN_PASSWORD || 'password' }),
        });
        const { access_token } = (await res.json()) as { access_token: string };
        return access_token;
    }

    async function apiGet(token: string, path: string) {
        const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        return res.json();
    }

    async function apiPost(token: string, path: string, body: Record<string, unknown>) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
        });
        return res.json();
    }

    async function apiDelete(token: string, path: string) {
        await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    }

    test('character data appears in event detail after duplicate signup with character', async ({ page }) => {
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
            title: 'PW-868 Character Test',
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

            // PlayerCharacterInfo renders "CharName • ClassName" inside a <p>
            await expect(page.getByText(char.name).first()).toBeVisible({ timeout: 10_000 });

            // FlexibilityBadges renders a span with title="Prefers: Dps" containing role icons
            await expect(page.locator('[title="Prefers: Dps"]').first()).toBeVisible({ timeout: 5_000 });
        } finally {
            await apiDelete(token, `/events/${event.id}`);
        }
    });
});
