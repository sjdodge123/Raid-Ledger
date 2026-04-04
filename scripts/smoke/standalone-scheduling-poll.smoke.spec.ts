/**
 * Standalone Scheduling Poll smoke tests (ROK-977).
 *
 * Verifies the two UI entry points for standalone scheduling polls:
 *   1. "Schedule a Game" button on the events page toolbar
 *   2. "Poll for Best Time" in the reschedule modal
 *
 * Acceptance Criteria covered:
 *   AC7:  Events page has "Schedule a Game" button visible to all members
 *   AC8:  CreatePollModal: game picker + member picker
 *   AC9:  After creating poll from events page, navigate to scheduling poll page
 *   AC10: RescheduleModal "Poll for Best Time" creates standalone poll
 *   AC11: After creating poll from reschedule, navigate to scheduling poll page
 *   AC12: Existing scheduling poll page works for standalone polls
 */
import { test, expect } from '@playwright/test';
import { navigateToFirstEvent, isMobile } from './helpers';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// API helpers — reused from scheduling-poll.smoke.spec.ts pattern
// ---------------------------------------------------------------------------

let _cachedToken: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function getAdminToken(): Promise<string> {
    if (_cachedToken) return _cachedToken;
    if (_tokenPromise) return _tokenPromise;
    _tokenPromise = (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(`${API_BASE}/auth/local`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: 'admin@local',
                    password: process.env.ADMIN_PASSWORD || 'password',
                }),
            });
            if (res.ok) {
                const { access_token } = (await res.json()) as {
                    access_token: string;
                };
                return access_token;
            }
            if (res.status === 429) {
                const wait = attempt === 0 ? 5_000 : 15_000;
                await new Promise((r) => setTimeout(r, wait));
                continue;
            }
            throw new Error(`Auth failed: ${res.status}`);
        }
        throw new Error('Auth failed after 3 attempts (rate limited)');
    })();
    _cachedToken = await _tokenPromise;
    _tokenPromise = null;
    return _cachedToken;
}

async function apiDelete(token: string, path: string) {
    await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
}

/** Get a valid gameId from seeded data. */
async function getFirstGameId(token: string): Promise<number> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch games: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games');
    return body.data[0].id;
}

// ---------------------------------------------------------------------------
// AC7: "Schedule a Game" button on events page
// ---------------------------------------------------------------------------

test.describe('Events page — Schedule a Game button', () => {
    test('desktop: "Schedule a Game" button is visible on events page toolbar', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — mobile uses different toolbar layout',
        );

        await page.goto('/events');
        await expect(
            page.getByRole('heading', { name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // AC7: The "Schedule a Game" button should be visible in the events toolbar
        const scheduleBtn = page.getByRole('link', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
    });

    test('mobile: "Schedule a Game" button is visible on events page', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'desktop',
            'Mobile-only test — uses mobile toolbar selectors',
        );

        await page.goto('/events');
        await expect(
            page.getByRole('heading', { name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // AC7: On mobile, the "Schedule a Game" action should still be accessible
        const scheduleBtn = page.getByRole('link', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// AC8: CreatePollModal — game picker + member picker
// ---------------------------------------------------------------------------

test.describe('CreatePollModal — game and member picker', () => {
    test('clicking "Schedule a Game" opens CreatePollModal with game picker', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — modal interaction differs on mobile',
        );

        await page.goto('/events');
        await expect(
            page.getByRole('heading', { name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // Click the "Schedule a Game" button
        const scheduleBtn = page.getByRole('link', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
        await scheduleBtn.click();

        // AC8: CreatePollModal should open with a heading
        const modal = page.locator('[role="dialog"]');
        await expect(
            modal.getByRole('heading', { name: /Schedule a Game|Create Scheduling Poll/i }),
        ).toBeVisible({ timeout: 10_000 });

        // AC8: Game picker (search input) should be visible
        const gameSearch = modal.locator(
            '[data-testid="game-search-input"]',
        );
        await expect(gameSearch).toBeVisible({ timeout: 5_000 });
    });

    test('CreatePollModal has member picker for multi-select', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — modal interaction differs on mobile',
        );

        await page.goto('/events');
        await expect(
            page.getByRole('heading', { name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        const scheduleBtn = page.getByRole('link', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
        await scheduleBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // AC8: Member picker should be visible for multi-select
        const memberPicker = modal.locator(
            '[data-testid="member-picker"]',
        );
        await expect(memberPicker).toBeVisible({ timeout: 5_000 });
    });

    test('game picker searches game library and shows results', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — modal interaction differs on mobile',
        );

        await page.goto('/events');
        await expect(
            page.getByRole('heading', { name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        const scheduleBtn = page.getByRole('link', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
        await scheduleBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // Type into game search — should show results from game library
        const gameSearch = modal.locator(
            '[data-testid="game-search-input"]',
        );
        await gameSearch.fill('Test');

        // Search results should appear (dropdown or list)
        const searchResults = modal.locator(
            '[data-testid="game-search-results"] [role="option"], [data-testid="game-option"]',
        );
        await expect(searchResults.first()).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// AC9: After creating poll from events page, navigate to scheduling poll page
// ---------------------------------------------------------------------------

test.describe('Events page poll creation navigates to scheduling poll', () => {
    test('submitting CreatePollModal navigates to scheduling poll page', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — full modal flow',
        );

        await page.goto('/events');
        await expect(
            page.getByRole('heading', { name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // Open CreatePollModal
        const scheduleBtn = page.getByRole('link', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
        await scheduleBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // Select a game in the picker
        const gameSearch = modal.locator(
            '[data-testid="game-search-input"]',
        );
        await gameSearch.fill('Test');
        const firstResult = modal.locator(
            '[data-testid="game-search-results"] [role="option"], [data-testid="game-option"]',
        ).first();
        await expect(firstResult).toBeVisible({ timeout: 10_000 });
        await firstResult.click();

        // Submit the form
        const submitBtn = modal.getByRole('button', {
            name: /Create Poll|Schedule|Start Poll/i,
        });
        await expect(submitBtn).toBeVisible({ timeout: 5_000 });
        await submitBtn.click();

        // AC9: Should navigate to the scheduling poll page
        await page.waitForURL(
            /\/community-lineup\/\d+\/schedule\/\d+/,
            { timeout: 15_000 },
        );
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
        );
    });
});

// ---------------------------------------------------------------------------
// AC10 + AC11: RescheduleModal "Poll for Best Time" creates standalone poll
// ---------------------------------------------------------------------------

test.describe('Reschedule modal — Poll for Best Time', () => {
    test('desktop: reschedule modal shows "Poll for Best Time" button', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'mobile',
            'Desktop-only test — Reschedule button visible on desktop, behind overflow on mobile',
        );

        await navigateToFirstEvent(page, testInfo);

        // Click Reschedule button
        const rescheduleBtn = page.getByRole('button', { name: 'Reschedule' });
        await expect(rescheduleBtn).toBeVisible({ timeout: 10_000 });
        await rescheduleBtn.click();

        // Modal should open
        const modal = page.locator('[role="dialog"]');
        await expect(
            modal.getByRole('heading', { name: 'Reschedule Event' }),
        ).toBeVisible({ timeout: 10_000 });

        // AC10: "Poll for Best Time" button should be visible
        const pollBtn = modal.getByRole('button', {
            name: /Poll for Best Time/i,
        });
        await expect(pollBtn).toBeVisible({ timeout: 10_000 });
    });

    test('mobile: reschedule modal shows "Poll for Best Time" button', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'desktop',
            'Mobile-only test',
        );

        await navigateToFirstEvent(page, testInfo);

        // Open overflow menu on mobile
        await expect(
            page.getByRole('button', { name: 'More actions' }),
        ).toBeVisible({ timeout: 10_000 });
        await page.getByRole('button', { name: 'More actions' }).click();

        // Click Reschedule in overflow
        const rescheduleBtn = page.getByRole('button', { name: 'Reschedule' });
        await expect(rescheduleBtn).toBeVisible({ timeout: 5_000 });
        await rescheduleBtn.click();

        // Modal/BottomSheet should open
        const modal = page.locator('[role="dialog"]').filter({
            hasText: 'Reschedule Event',
        });
        await expect(
            modal.getByRole('heading', { name: 'Reschedule Event' }),
        ).toBeVisible({ timeout: 10_000 });

        // AC10: "Poll for Best Time" button should be visible
        const pollBtn = modal.getByRole('button', {
            name: /Poll for Best Time/i,
        });
        await expect(pollBtn).toBeVisible({ timeout: 10_000 });
    });

    test('clicking "Poll for Best Time" navigates to scheduling poll page (not /events?tab=plans)', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'mobile',
            'Desktop-only test — full modal flow',
        );

        await navigateToFirstEvent(page, testInfo);

        // Open reschedule modal
        const rescheduleBtn = page.getByRole('button', { name: 'Reschedule' });
        await expect(rescheduleBtn).toBeVisible({ timeout: 10_000 });
        await rescheduleBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(
            modal.getByRole('heading', { name: 'Reschedule Event' }),
        ).toBeVisible({ timeout: 10_000 });

        // Click "Poll for Best Time"
        const pollBtn = modal.getByRole('button', {
            name: /Poll for Best Time/i,
        });
        await expect(pollBtn).toBeVisible({ timeout: 10_000 });
        await pollBtn.click();

        // AC11: Should navigate to the scheduling poll page — NOT /events?tab=plans
        await page.waitForURL(
            /\/community-lineup\/\d+\/schedule\/\d+/,
            { timeout: 15_000 },
        );

        // Verify we are NOT on /events?tab=plans
        const currentUrl = page.url();
        expect(currentUrl).not.toContain('/events?tab=plans');
        expect(currentUrl).toMatch(/\/community-lineup\/\d+\/schedule\/\d+/);

        // Page should load without errors
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
        );
    });
});

// ---------------------------------------------------------------------------
// AC12: Existing scheduling poll page works for standalone polls
// ---------------------------------------------------------------------------

test.describe('Standalone poll — scheduling poll page', () => {
    test.describe.configure({ timeout: 120_000 });

    test('standalone poll renders on the scheduling poll page with core UI elements', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — full flow',
        );

        const token = await getAdminToken();
        const gameId = await getFirstGameId(token);

        // Create a standalone poll via the API endpoint
        const createRes = await fetch(`${API_BASE}/scheduling-polls`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ gameId }),
        });

        // If the endpoint doesn't exist yet, this will fail (expected for TDD)
        expect(createRes.status).toBe(201);

        const poll = (await createRes.json()) as {
            id: number;
            lineupId: number;
        };

        try {
            // Navigate to the scheduling poll page
            await page.goto(
                `/community-lineup/${poll.lineupId}/schedule/${poll.id}`,
            );

            // AC12: The scheduling poll page should render for standalone polls
            const pollHeading = page.locator('h1', {
                hasText: 'Scheduling Poll',
            });

            // Handle wizard steps if present
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
            for (let i = 0; i < 5; i++) {
                if (await pollHeading.isVisible({ timeout: 3_000 }).catch(() => false)) break;
                for (const label of ['Skip', 'Continue', 'Save & Continue', 'Done']) {
                    const btn = page.locator('button', { hasText: label }).first();
                    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
                        await btn.click();
                        await page.waitForTimeout(500);
                        break;
                    }
                }
            }

            await expect(pollHeading).toBeVisible({ timeout: 15_000 });

            // Core scheduling poll UI should work for standalone polls
            // Match context card should show the game
            const contextCard = page.locator('[data-testid="match-context-card"]');
            await expect(contextCard).toBeVisible({ timeout: 10_000 });

            // Suggest slot input should be present
            const dateTimeInput = page.locator(
                'input[type="datetime-local"], [data-testid="slot-datetime-picker"]',
            );
            await expect(dateTimeInput).toBeVisible({ timeout: 10_000 });

            // Page should not show errors
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
            );
        } finally {
            // Cleanup: delete the standalone poll lineup if possible
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });
});
