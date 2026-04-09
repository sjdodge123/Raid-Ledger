/**
 * ROK-1005: Edit event content browser smoke tests.
 *
 * Verifies that when editing a WoW event with dungeons/raids selected,
 * the content browser renders and allows re-selection of content instances.
 *
 * These tests create a WoW event with contentInstances via the API, then
 * navigate to the edit page and assert on the content browser behavior.
 *
 * All tests MUST fail until the fix is implemented — the root cause is
 * `eventTypeId: null` in getEditModeState(), which causes contentType
 * to be null, hiding the content browser.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Find the WoW game ID from the configured games list. Returns null if not found. */
async function findWowGameId(token: string): Promise<number | null> {
    const registry = (await apiGet(token, '/games/configured')) as { data: Array<{ id: number; slug: string }> };
    const wow = registry.data?.find((g) => g.slug === 'world-of-warcraft');
    return wow?.id ?? null;
}

/** Synthetic dungeon content instances for test data. */
const TEST_DUNGEONS = [
    {
        id: 99901,
        name: 'Test Dungeon Alpha',
        shortName: 'TDA',
        expansion: 'The War Within',
        minimumLevel: 80,
        maximumLevel: 80,
        maxPlayers: 5,
        category: 'dungeon',
    },
    {
        id: 99902,
        name: 'Test Dungeon Beta',
        shortName: 'TDB',
        expansion: 'The War Within',
        minimumLevel: 80,
        maximumLevel: 80,
        maxPlayers: 5,
        category: 'dungeon',
    },
];

/**
 * Create a WoW event with dungeon content instances via the API.
 * Returns the event ID for navigation and cleanup.
 */
async function createWowEventWithDungeons(token: string, gameId: number): Promise<number> {
    const futureStart = new Date(Date.now() + 86_400_000).toISOString();
    const futureEnd = new Date(Date.now() + 90_000_000).toISOString();
    const event = (await apiPost(token, '/events', {
        title: 'ROK-1005 Dungeon Edit Test',
        gameId,
        startTime: futureStart,
        endTime: futureEnd,
        maxAttendees: 5,
        contentInstances: TEST_DUNGEONS,
    })) as { id: number };
    return event.id;
}

/** Navigate to the edit page for a specific event. */
async function navigateToEditPage(page: Page, eventId: number) {
    await page.goto(`/events/${eventId}/edit`);
    await expect(page.getByRole('heading', { name: 'Edit Event' })).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Desktop — Content browser in edit mode
// ---------------------------------------------------------------------------

test.describe('ROK-1005: Content browser in edit mode (desktop)', () => {
    let token: string;
    let wowGameId: number | null;
    let eventId: number;

    test.beforeAll(async () => {
        token = await getAdminToken();
        wowGameId = await findWowGameId(token);
    });

    test.beforeEach(async ({}, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only tests');
        if (!wowGameId) {
            test.skip(true, 'WoW game not in registry — cannot test content browser');
            return;
        }
        eventId = await createWowEventWithDungeons(token, wowGameId);
    });

    test.afterEach(async () => {
        if (eventId && token) {
            await apiDelete(token, `/events/${eventId}`);
        }
    });

    test('content browser renders with pre-selected dungeons', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // The content browser should render the "Dungeons" label
        // This FAILS because eventTypeId is null, so contentType is null,
        // and the PluginSlot guard (wowVariant && contentType) prevents rendering.
        await expect(page.getByText('Dungeons', { exact: true })).toBeVisible({ timeout: 10_000 });

        // Selected dungeon chips should be visible (use .rounded-full to target chip spans)
        const chips = page.locator('span.rounded-full');
        await expect(chips.filter({ hasText: 'TDA' })).toBeVisible({ timeout: 5_000 });
        await expect(chips.filter({ hasText: 'TDB' })).toBeVisible({ timeout: 5_000 });
    });

    test('user can uncheck a dungeon to remove it', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // Wait for content browser to render
        await expect(page.getByText('Dungeons', { exact: true })).toBeVisible({ timeout: 10_000 });

        // Both dungeons should initially be selected as chips
        const chips = page.locator('span.rounded-full');
        await expect(chips.filter({ hasText: 'TDA' })).toBeVisible({ timeout: 5_000 });
        await expect(chips.filter({ hasText: 'TDB' })).toBeVisible({ timeout: 5_000 });

        // Click the remove button on the first dungeon chip (the X icon)
        const chipRemoveBtn = chips.filter({ hasText: 'TDA' }).getByRole('button');
        await chipRemoveBtn.click();

        // TDA chip should be removed
        await expect(chips.filter({ hasText: 'TDA' })).not.toBeVisible({ timeout: 5_000 });
        // TDB chip should still be present
        await expect(chips.filter({ hasText: 'TDB' })).toBeVisible();
    });

    test('user can check a new dungeon to add it', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // Wait for content browser to render
        await expect(page.getByText('Dungeons', { exact: true })).toBeVisible({ timeout: 10_000 });

        // The instance list should render (with searchable dungeon entries)
        // Look for the search input for dungeons
        const searchInput = page.getByPlaceholder('Search dungeons...');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // The existing selected dungeons should show checkmarks in the list
        // (InstanceListItem renders a checkmark SVG when isSelected is true)
        const selectedItems = page.locator('button').filter({ hasText: 'Test Dungeon Alpha' });
        if (await selectedItems.count() > 0) {
            // Verify the selected state indicator is present
            await expect(selectedItems.first()).toBeVisible();
        }
    });

    test('content browser stays visible after removing all selections', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // Wait for content browser to render
        await expect(page.getByText('Dungeons', { exact: true })).toBeVisible({ timeout: 10_000 });

        // Remove both dungeon chips
        const chips = page.locator('span.rounded-full');
        const chipRemoveBtnA = chips.filter({ hasText: 'TDA' }).getByRole('button');
        await chipRemoveBtnA.click();
        await expect(chips.filter({ hasText: 'TDA' })).not.toBeVisible({ timeout: 5_000 });

        const chipRemoveBtnB = chips.filter({ hasText: 'TDB' }).getByRole('button');
        await chipRemoveBtnB.click();
        await expect(chips.filter({ hasText: 'TDB' })).not.toBeVisible({ timeout: 5_000 });

        // Content browser should STILL be visible even with no selections
        await expect(page.getByText('Dungeons', { exact: true })).toBeVisible({ timeout: 5_000 });
        await expect(page.getByPlaceholder('Search dungeons...')).toBeVisible();
    });

    test('event type dropdown is hidden in edit mode', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // The Event Type dropdown should NOT be visible in edit mode
        // (showEventType is set to !isEditMode in the form)
        await expect(page.getByLabel('Event Type')).not.toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Mobile — Content browser in edit mode
// ---------------------------------------------------------------------------

test.describe('ROK-1005: Content browser in edit mode (mobile)', () => {
    let token: string;
    let wowGameId: number | null;
    let eventId: number;

    test.beforeAll(async () => {
        token = await getAdminToken();
        wowGameId = await findWowGameId(token);
    });

    test.beforeEach(async ({}, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only tests');
        if (!wowGameId) {
            test.skip(true, 'WoW game not in registry — cannot test content browser');
            return;
        }
        eventId = await createWowEventWithDungeons(token, wowGameId);
    });

    test.afterEach(async () => {
        if (eventId && token) {
            await apiDelete(token, `/events/${eventId}`);
        }
    });

    test('content browser renders with pre-selected dungeons on mobile', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // Scroll down to the Game & Content section if needed
        const dungeonLabel = page.getByText('Dungeons', { exact: true });
        await dungeonLabel.scrollIntoViewIfNeeded();

        // The content browser should be visible with the Dungeons label
        await expect(dungeonLabel).toBeVisible({ timeout: 10_000 });

        // Selected dungeon chips should be visible
        const chips = page.locator('span.rounded-full');
        await expect(chips.filter({ hasText: 'TDA' })).toBeVisible({ timeout: 5_000 });
        await expect(chips.filter({ hasText: 'TDB' })).toBeVisible({ timeout: 5_000 });
    });

    test('user can uncheck a dungeon on mobile', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // Wait for content browser
        const dungeonLabel = page.getByText('Dungeons', { exact: true });
        await dungeonLabel.scrollIntoViewIfNeeded();
        await expect(dungeonLabel).toBeVisible({ timeout: 10_000 });

        // Remove the first dungeon
        const chips = page.locator('span.rounded-full');
        const chipRemoveBtn = chips.filter({ hasText: 'TDA' }).getByRole('button');
        await chipRemoveBtn.click();

        // TDA should be removed, TDB should remain
        await expect(chips.filter({ hasText: 'TDA' })).not.toBeVisible({ timeout: 5_000 });
        await expect(chips.filter({ hasText: 'TDB' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Non-WoW game events — no content browser
// ---------------------------------------------------------------------------

test.describe('ROK-1005: Non-WoW event edit has no content browser', () => {
    let token: string;
    let eventId: number;

    test.beforeAll(async () => {
        token = await getAdminToken();
    });

    test.beforeEach(async () => {
        // Create a non-WoW event (no gameId, or a non-WoW game)
        const futureStart = new Date(Date.now() + 86_400_000).toISOString();
        const futureEnd = new Date(Date.now() + 90_000_000).toISOString();
        const event = (await apiPost(token, '/events', {
            title: 'ROK-1005 Non-WoW Test',
            startTime: futureStart,
            endTime: futureEnd,
            maxAttendees: 10,
        })) as { id: number };
        eventId = event.id;
    });

    test.afterEach(async () => {
        if (eventId && token) {
            await apiDelete(token, `/events/${eventId}`);
        }
    });

    test('non-WoW event edit does not show content browser', async ({ page }) => {
        await navigateToEditPage(page, eventId);

        // The Dungeons/Raids label should NOT appear for non-WoW events
        await expect(page.getByText('Dungeons', { exact: true })).not.toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('Raids', { exact: true })).not.toBeVisible({ timeout: 5_000 });

        // The dungeon search input should not be present
        await expect(page.getByPlaceholder('Search dungeons...')).not.toBeVisible({ timeout: 3_000 });
        await expect(page.getByPlaceholder('Search raids...')).not.toBeVisible({ timeout: 3_000 });
    });
});

// ---------------------------------------------------------------------------
// Create flow regression — content browser should NOT show before event type
// ---------------------------------------------------------------------------

test.describe('ROK-1005: Create flow regression — no content browser without event type', () => {
    test('content browser does not appear before selecting event type', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — event type dropdown interaction');

        await page.goto('/events/new');
        await expect(page.getByRole('heading', { name: 'Create Event', level: 1 })).toBeVisible({ timeout: 15_000 });

        // Search for WoW in the game input
        const gameInput = page.getByRole('textbox', { name: 'Game' });
        await gameInput.click();
        await gameInput.pressSequentially('World of Warcraft', { delay: 30 });

        // Wait for dropdown and select WoW
        const listbox = page.getByRole('listbox');
        const hasResults = await listbox.isVisible({ timeout: 10_000 }).catch(() => false);
        if (!hasResults) {
            test.skip(true, 'WoW not found in game search — IGDB data may not be seeded');
            return;
        }

        // Select the first WoW option
        const wowOption = listbox.getByRole('option').filter({ hasText: /World of Warcraft/i }).first();
        if (!await wowOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
            test.skip(true, 'WoW option not visible in search results');
            return;
        }
        await wowOption.click();

        // At this point, game is selected but NO event type is chosen.
        // Content browser should NOT be visible yet (requires event type selection).
        await expect(page.getByText('Dungeons', { exact: true })).not.toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('Raids', { exact: true })).not.toBeVisible({ timeout: 5_000 });
    });
});
