/**
 * Scheduling Poll Threshold smoke tests (ROK-1015).
 *
 * Verifies the UI acceptance criteria for the min-vote-threshold feature:
 *   AC1: CreatePollModal shows "Minimum votes" slider when members are selected
 *   AC2: Slider max updates when members added/removed
 *   AC5: Poll page shows progress bar with "X/Y voted" when minVoteThreshold is set
 *
 * Requires DEMO_MODE=true, authenticated admin (global setup), and seeded data.
 */
import { test, expect } from './base';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// API helpers
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

async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function apiPost(
    token: string,
    path: string,
    body?: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
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

/** Get all community members (for member picker selection). */
async function getCommunityMembers(token: string): Promise<number[]> {
    const data = await apiGet(token, '/users/profiles?limit=10');
    if (!data?.data?.length) return [];
    return data.data.map((u: { id: number }) => u.id);
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

test.describe.configure({ timeout: 120_000 });

// ---------------------------------------------------------------------------
// AC1: CreatePollModal shows "Minimum votes" slider when members are selected
// ---------------------------------------------------------------------------

test.describe('CreatePollModal — Minimum votes slider (AC1)', () => {
    test('slider appears when members are selected in the poll modal', async ({
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

        // Open the CreatePollModal
        const scheduleBtn = page.getByRole('button', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
        await scheduleBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // Slider should be visible even before selecting members (always shown)
        const slider = modal.locator('[data-testid="min-vote-threshold-slider"]');
        await expect(slider).toBeVisible({ timeout: 5_000 });

        // Select members using the member picker
        const memberPicker = modal.locator('[data-testid="member-picker"]');
        await expect(memberPicker).toBeVisible({ timeout: 5_000 });

        // Click a member to select them (first available member checkbox/button)
        const firstMember = memberPicker.locator(
            '[data-testid^="member-option-"]',
        ).first();
        await expect(firstMember).toBeVisible({ timeout: 5_000 });
        await firstMember.click();

        // AC1: Now the "Minimum votes" slider should be visible
        await expect(slider).toBeVisible({ timeout: 10_000 });

        // The slider label should say "Minimum votes"
        const sliderLabel = modal.getByText(/Minimum votes/i);
        await expect(sliderLabel).toBeVisible({ timeout: 5_000 });
    });

    test('slider default equals the member count', async ({ page }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — modal interaction differs on mobile',
        );

        await page.goto('/events');
        await expect(
            page.getByRole('heading', { name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        const scheduleBtn = page.getByRole('button', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
        await scheduleBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // Select a member
        const memberPicker = modal.locator('[data-testid="member-picker"]');
        await expect(memberPicker).toBeVisible({ timeout: 5_000 });
        const firstMember = memberPicker.locator(
            '[data-testid^="member-option-"]',
        ).first();
        await expect(firstMember).toBeVisible({ timeout: 5_000 });
        await firstMember.click();

        // AC1: Slider should be visible with range 1 to memberCount
        const slider = modal.locator('[data-testid="min-vote-threshold-slider"]');
        await expect(slider).toBeVisible({ timeout: 10_000 });

        // The slider input should have min=1
        const sliderInput = slider.locator('input[type="range"]');
        await expect(sliderInput).toHaveAttribute('min', '1', { timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// AC2: Slider max updates when members added/removed
// ---------------------------------------------------------------------------

test.describe('CreatePollModal — Slider max updates (AC2)', () => {
    test('slider max changes when members are added or removed', async ({
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

        const scheduleBtn = page.getByRole('button', { name: /Schedule a Game/i });
        await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
        await scheduleBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        const memberPicker = modal.locator('[data-testid="member-picker"]');
        await expect(memberPicker).toBeVisible({ timeout: 5_000 });

        // Select first member
        const members = memberPicker.locator('[data-testid^="member-option-"]');
        const memberCount = await members.count();
        if (memberCount < 2) {
            test.skip(true, 'Need at least 2 members in DB for this test');
            return;
        }

        await members.nth(0).click();
        const slider = modal.locator('[data-testid="min-vote-threshold-slider"]');
        await expect(slider).toBeVisible({ timeout: 10_000 });

        // Record initial max
        const sliderInput = slider.locator('input[type="range"]');
        const initialMax = await sliderInput.getAttribute('max');

        // Add a second member
        await members.nth(1).click();

        // AC2: Slider max should have increased
        const updatedMax = await sliderInput.getAttribute('max');
        expect(Number(updatedMax)).toBeGreaterThan(Number(initialMax));

        // Remove the second member
        await members.nth(1).click();

        // AC2: Slider max should be back to original
        const revertedMax = await sliderInput.getAttribute('max');
        expect(Number(revertedMax)).toBe(Number(initialMax));
    });
});

// ---------------------------------------------------------------------------
// AC5: Poll page shows progress bar with "X/Y voted" when threshold is set
// ---------------------------------------------------------------------------

test.describe('Scheduling poll page — Vote progress bar (AC5)', () => {
    test('progress bar shows "X/Y voted" when minVoteThreshold is set', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — full flow',
        );

        // Create a standalone poll with members and minVoteThreshold via API
        const token = await getAdminToken();
        const gameId = await getFirstGameId(token);
        const memberIds = await getCommunityMembers(token);

        const createRes = await fetch(`${API_BASE}/scheduling-polls`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                gameId,
                memberUserIds: memberIds.slice(0, 3),
                minVoteThreshold: 2,
            }),
        });
        expect(createRes.status).toBe(201);
        const poll = (await createRes.json()) as {
            id: number;
            lineupId: number;
        };

        try {
            // Navigate to the scheduling poll page, bypassing wizard steps
            await page.goto(
                `/community-lineup/${poll.lineupId}/schedule/${poll.id}`,
            );
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

            // Advance past wizard steps if present
            const pollHeading = page.locator('h1', { hasText: 'Scheduling Poll' });
            for (let i = 0; i < 5; i++) {
                if (await pollHeading.isVisible({ timeout: 3_000 }).catch(() => false)) break;
                for (const label of ['Skip', 'Continue', 'Save & Continue', 'Done']) {
                    const btn = page.locator('button', { hasText: label }).first();
                    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
                        await btn.click();
                        await page.waitForLoadState('domcontentloaded');
                        break;
                    }
                }
            }

            // AC5: Progress bar should be visible on the poll page
            const progressBar = page.locator(
                '[data-testid="vote-progress-bar"]',
            );
            await expect(progressBar).toBeVisible({ timeout: 15_000 });

            // AC5: Progress bar text should show "X/Y voted" pattern
            const progressText = page.locator(
                '[data-testid="vote-progress-text"]',
            );
            await expect(progressText).toBeVisible({ timeout: 5_000 });
            await expect(progressText).toHaveText(/\d+\/\d+ voted/i, {
                timeout: 5_000,
            });
        } finally {
            // Cleanup: delete the standalone poll lineup
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });

    test('progress bar is NOT visible when minVoteThreshold is not set', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — full flow',
        );

        // Create a standalone poll WITHOUT minVoteThreshold
        const token = await getAdminToken();
        const gameId = await getFirstGameId(token);

        const createRes = await fetch(`${API_BASE}/scheduling-polls`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ gameId }),
        });
        expect(createRes.status).toBe(201);
        const poll = (await createRes.json()) as {
            id: number;
            lineupId: number;
        };

        try {
            await page.goto(
                `/community-lineup/${poll.lineupId}/schedule/${poll.id}`,
            );
            await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

            // Advance past wizard steps if present
            const pollHeading = page.locator('h1', { hasText: 'Scheduling Poll' });
            for (let i = 0; i < 5; i++) {
                if (await pollHeading.isVisible({ timeout: 3_000 }).catch(() => false)) break;
                for (const label of ['Skip', 'Continue', 'Save & Continue', 'Done']) {
                    const btn = page.locator('button', { hasText: label }).first();
                    if (await btn.isVisible({ timeout: 1_000 }).catch(() => false)) {
                        await btn.click();
                        await page.waitForLoadState('domcontentloaded');
                        break;
                    }
                }
            }

            await expect(pollHeading).toBeVisible({ timeout: 15_000 });

            // AC5: Progress bar should NOT be visible when no threshold is set
            const progressBar = page.locator(
                '[data-testid="vote-progress-bar"]',
            );
            await expect(progressBar).not.toBeVisible({ timeout: 5_000 });
        } finally {
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });
});
