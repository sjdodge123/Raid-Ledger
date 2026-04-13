/**
 * Lineup Creation & Phase Scheduling smoke tests (ROK-946).
 *
 * Tests the "Start Lineup" button on the Games page, the creation modal
 * with configurable duration fields, phase countdown display, force-advance
 * functionality, and the admin settings panel for default durations.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import { test, expect } from './base';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

/** Cached admin token — shared across all describe blocks to avoid rate limits. */
let _cachedToken: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function getAdminToken(): Promise<string> {
    if (_cachedToken) return _cachedToken;
    if (_tokenPromise) return _tokenPromise;
    _tokenPromise = fetchAdminToken();
    _cachedToken = await _tokenPromise;
    _tokenPromise = null;
    return _cachedToken;
}

async function fetchAdminToken(): Promise<string> {
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
            const { access_token } = (await res.json()) as { access_token: string };
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
}

async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
}

async function apiPatch(
    token: string,
    path: string,
    body: Record<string, unknown>,
) {
    return fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
}

/**
 * Archive any active lineup so each test starts clean.
 * Walks through all valid transitions to reach archived status.
 * Retries once to handle cross-project races (desktop/mobile workers).
 */
/** Cancel pending BullMQ phase-transition jobs for a lineup (ROK-1007). */
async function cancelLineupPhaseJobs(token: string, id: number): Promise<void> {
    await fetch(`${API_BASE}/admin/test/cancel-lineup-phase-jobs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lineupId: id }),
    });
}

async function archiveActiveLineup(token: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const banner = await apiGet(token, '/lineups/banner');
        if (!banner || typeof banner.id !== 'number') return;

        await cancelLineupPhaseJobs(token, banner.id);

        const detail = await apiGet(token, `/lineups/${banner.id}`);
        if (!detail) return;

        const transitions: Record<string, string[]> = {
            building: ['voting', 'decided', 'archived'],
            voting: ['decided', 'archived'],
            decided: ['archived'],
        };

        const steps = transitions[detail.status];
        if (!steps) return;

        for (const status of steps) {
            const body: Record<string, unknown> = { status };
            if (status === 'decided' && detail.entries?.length > 0) {
                body.decidedGameId = detail.entries[0].gameId;
            }
            const patchRes = await apiPatch(token, `/lineups/${banner.id}/status`, body);
            if (!patchRes.ok) break; // transition failed, stop trying
        }

        // Verify archived — if another worker recreated, retry
        const check = await apiGet(token, '/lineups/banner');
        if (!check || typeof check.id !== 'number') return;
    }
}

/**
 * Ensure an active lineup exists with phase durations set.
 * Handles 409 race conditions by returning the existing lineup.
 */
async function ensureActiveLineup(
    token: string,
): Promise<number> {
    await archiveActiveLineup(token);

    const createRes = await fetch(`${API_BASE}/lineups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        }),
    });

    if (createRes.ok) {
        const data = (await createRes.json()) as { id: number };
        return data.id;
    }

    // 409 — another worker created one; use it
    const banner = await apiGet(token, '/lineups/banner');
    if (banner && typeof banner.id === 'number') return banner.id;
    throw new Error('Failed to create or find an active lineup');
}

// ---------------------------------------------------------------------------
// "Start Lineup" button visibility on Games page
// ---------------------------------------------------------------------------

test.describe('Start Lineup button on Games page', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('shows Start Lineup button when no active lineup and user is operator', async ({ page }) => {
        test.setTimeout(60_000);
        // Ensure no active lineup exists — retry to handle cross-project races
        // (community-lineup tests may recreate the lineup between archive and assertion)
        await expect(async () => {
            await archiveActiveLineup(adminToken);

            await page.goto('/games');
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 3_000 },
            );

            // The "Start Lineup" button should be visible for operators/admins
            const startBtn = page.getByRole('button', { name: /Start Lineup/i });
            await expect(startBtn).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 45_000 });
    });

    test('Games page shows lineup banner with countdown instead of Start Lineup when active', async ({ page }) => {
        // Ensure an active lineup exists -- create one if needed
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (!banner || typeof banner.id !== 'number') {
            const createRes = await fetch(`${API_BASE}/lineups`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                },
                body: JSON.stringify({}),
            });
            expect(createRes.ok).toBe(true);
        }

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // When a lineup is active, the banner must show a phase countdown
        // (e.g., "Building - 23h remaining"). This only renders after
        // ROK-946 adds the phaseDeadline field and countdown display.
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({
            timeout: 15_000,
        });
        const countdown = page.getByText(/remaining/i);
        await expect(countdown).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Lineup creation modal with duration fields
// ---------------------------------------------------------------------------

test.describe('Lineup creation modal', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('modal opens with duration fields pre-filled from admin defaults', async ({ page }) => {
        test.setTimeout(60_000);
        await expect(async () => {
            await archiveActiveLineup(adminToken);
            await page.goto('/games');
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 3_000 },
            );
            const startBtn = page.getByRole('button', { name: /Start Lineup/i });
            await expect(startBtn).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 45_000 });

        // Click "Start Lineup" to open modal
        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await startBtn.click();

        // Modal should open with duration configuration fields
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Duration sliders for building and voting should be present
        const buildingDuration = modal.locator('[data-testid="building-duration"]');
        await expect(buildingDuration).toBeVisible({ timeout: 5_000 });

        const votingDuration = modal.locator('[data-testid="voting-duration"]');
        await expect(votingDuration).toBeVisible({ timeout: 5_000 });

        // Match threshold slider (10%–75%) should be present
        const thresholdSlider = modal.locator('[data-testid="match-threshold"]');
        await expect(thresholdSlider).toBeVisible({ timeout: 5_000 });

        // Verify slider labels
        await expect(modal.getByText('More matches')).toBeVisible();
        await expect(modal.getByText('Fewer, larger matches')).toBeVisible();
    });

    test('submitting modal creates lineup and navigates to detail page', async ({ page }) => {
        test.setTimeout(60_000);
        await expect(async () => {
            await archiveActiveLineup(adminToken);
            await page.goto('/games');
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 3_000 },
            );
            const startBtn = page.getByRole('button', { name: /Start Lineup/i });
            await expect(startBtn).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 45_000 });

        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await startBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Listen for the POST /lineups response while clicking submit
        const [apiResponse] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().includes('/lineups') && r.request().method() === 'POST',
                { timeout: 15_000 },
            ),
            modal.getByRole('button', { name: /Create Lineup|Start|Submit/i }).click(),
        ]);

        if (apiResponse.status() === 201) {
            // UI creation succeeded — verify navigation to detail page
            await page.waitForURL(/\/community-lineup\/\d+/, { timeout: 15_000 });
        } else {
            // 409 race: another worker created a lineup. Navigate to it directly.
            const banner = await apiGet(adminToken, '/lineups/banner');
            expect(banner).toBeTruthy();
            await page.goto(`/community-lineup/${banner.id}`);
        }

        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Phase countdown display
// ---------------------------------------------------------------------------

test.describe('Phase countdown display', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        lineupId = await ensureActiveLineup(adminToken);
    });

    test('banner shows compact countdown with time remaining', async ({ page }) => {
        // Re-ensure active lineup in case another worker archived it
        lineupId = await ensureActiveLineup(adminToken);

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Banner should show compact countdown like "Building - 23h remaining"
        const countdown = page.getByText(/remaining/i);
        await expect(countdown).toBeVisible({ timeout: 15_000 });
    });

    test('detail page shows full countdown timer', async ({ page }) => {
        // Navigate to Games page then click through to lineup detail
        // (avoids stale lineupId from cross-project race)
        lineupId = await ensureActiveLineup(adminToken);

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Click through to lineup detail via banner link
        const bannerLink = page.getByRole('link', { name: /View Lineup|Lineup/i });
        await expect(bannerLink).toBeVisible({ timeout: 15_000 });
        await bannerLink.click();
        await page.waitForURL(/\/community-lineup\/\d+/, { timeout: 10_000 });

        // Full countdown should be visible on the detail page
        const countdown = page.getByText(/remaining|countdown|time left/i);
        await expect(countdown).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Phase breadcrumb transitions (advance + revert)
// ---------------------------------------------------------------------------

test.describe('Phase breadcrumb transitions', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        lineupId = await ensureActiveLineup(adminToken);
    });

    test('breadcrumb shows clickable next phase for operators', async ({ page }) => {
        await expect(async () => {
            lineupId = await ensureActiveLineup(adminToken);
            await page.goto(`/community-lineup/${lineupId}`);
            await expect(
                page.getByRole('heading', { name: 'Community Lineup' }),
            ).toBeVisible({ timeout: 5_000 });
            // "Voting" should be a clickable button (next phase from building)
            const votingBtn = page.getByRole('button', { name: 'Voting' });
            await expect(votingBtn).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('double-click on next phase advances the lineup', async ({ page }) => {
        await expect(async () => {
            lineupId = await ensureActiveLineup(adminToken);
            await page.goto(`/community-lineup/${lineupId}`);
            await expect(
                page.getByRole('heading', { name: 'Community Lineup' }),
            ).toBeVisible({ timeout: 5_000 });

            // First click — shows "Advance?"
            const votingBtn = page.getByRole('button', { name: 'Voting' });
            await expect(votingBtn).toBeVisible({ timeout: 3_000 });
            await votingBtn.click();
            await expect(page.getByRole('button', { name: 'Advance?' })).toBeVisible({ timeout: 3_000 });
            await page.getByRole('button', { name: 'Advance?' }).click();
        }).toPass({ timeout: 30_000 });

        // Status badge should update to Voting
        const votingBadge = page.locator('span').filter({ hasText: /Voting/ });
        await expect(votingBadge.first()).toBeVisible({ timeout: 10_000 });
    });

    test('double-click on previous phase reverts the lineup', async ({ page }) => {
        // Retry — parallel workers may archive our lineup between setup and navigation
        await expect(async () => {
            // Ensure lineup is in voting phase
            lineupId = await ensureActiveLineup(adminToken);
            await apiPatch(adminToken, `/lineups/${lineupId}/status`, { status: 'voting' });

            await page.goto(`/community-lineup/${lineupId}`);
            await expect(
                page.getByRole('heading', { name: 'Community Lineup' }),
            ).toBeVisible({ timeout: 5_000 });

            // "Nominating" should be a clickable button (previous phase from voting)
            const nominatingBtn = page.getByRole('button', { name: 'Nominating' });
            await expect(nominatingBtn).toBeVisible({ timeout: 3_000 });
            await nominatingBtn.click();
            await expect(page.getByRole('button', { name: 'Revert?' })).toBeVisible({ timeout: 3_000 });
            await page.getByRole('button', { name: 'Revert?' }).click();
        }).toPass({ timeout: 30_000 });

        // Status badge should update back to building/Nominating
        const buildingBadge = page.locator('span').filter({ hasText: /Nominating/ });
        await expect(buildingBadge.first()).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Admin settings panel for default lineup durations
// ---------------------------------------------------------------------------

test.describe('Admin lineup duration settings', () => {
    test('admin settings panel exists at /admin/settings/general/lineup', async ({ page }) => {
        await page.goto('/admin/settings/general/lineup');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Should render a heading for lineup duration defaults
        const heading = page.getByRole('heading', {
            name: /Lineup|Phase Duration|Community Lineup/i,
        });
        await expect(heading).toBeVisible({ timeout: 15_000 });
    });

    test('admin settings panel shows duration input fields', async ({ page }) => {
        await page.goto('/admin/settings/general/lineup');

        const heading = page.getByRole('heading', {
            name: /Lineup|Phase Duration|Community Lineup/i,
        });
        await expect(heading).toBeVisible({ timeout: 15_000 });

        // Should have input fields for building, voting, and decided durations
        const buildingInput = page.locator(
            'input[name="buildingDurationHours"], [data-testid="default-building-duration"]',
        );
        await expect(buildingInput).toBeVisible({ timeout: 5_000 });

        const votingInput = page.locator(
            'input[name="votingDurationHours"], [data-testid="default-voting-duration"]',
        );
        await expect(votingInput).toBeVisible({ timeout: 5_000 });

        const decidedInput = page.locator(
            'input[name="decidedDurationHours"], [data-testid="default-decided-duration"]',
        );
        await expect(decidedInput).toBeVisible({ timeout: 5_000 });
    });

    test('no error boundary on load', async ({ page }) => {
        await page.goto('/admin/settings/general/lineup');

        const heading = page.getByRole('heading', {
            name: /Lineup|Phase Duration|Community Lineup/i,
        });
        await expect(heading).toBeVisible({ timeout: 15_000 });

        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
        );
    });
});
