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
import { API_BASE, getAdminToken, apiGet, createLineupOrRetry } from './api-helpers';

// ROK-1147: this whole file asserts global state ("Start Lineup button visible
// when no active lineup exists"). With per-worker title-prefix isolation,
// sibling workers can hold their own lineups concurrently and the banner
// shows their lineup, masking the Start Lineup button. Run serially so only
// one worker exercises this file at a time.
test.describe.configure({ mode: 'serial' });

/** Local apiPatch that returns raw Response (used by this file's callers). */
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

// ROK-1147: per-worker title prefix scopes /admin/test/reset-lineups so sibling
// workers don't archive each other's lineups mid-test.
const FILE_PREFIX = 'lineup-creation';
let workerPrefix: string;
let lineupTitle: string;

/**
 * Archive lineups owned by THIS worker (ROK-1147).
 *
 * `/admin/test/reset-lineups` (DEMO_MODE-only) only archives lineups whose
 * title starts with `workerPrefix`, so sibling workers are unaffected.
 */
async function archiveActiveLineup(token: string): Promise<void> {
    await fetch(`${API_BASE}/admin/test/reset-lineups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ titlePrefix: workerPrefix }),
    });
}

/**
 * Ensure an active lineup exists with phase durations set.
 * Handles 409 race conditions by returning the existing lineup.
 */
async function ensureActiveLineup(
    token: string,
): Promise<number> {
    // ROK-1070: switched from bare POST /lineups + /lineups/banner fallback on
    // 409 to createLineupOrRetry. The fallback returned whatever active lineup
    // existed (possibly a sibling-worker row in voting/decided), making
    // subsequent phase assertions non-deterministic. The retry helper archives
    // sibling rows by prefix and re-POSTs, guaranteeing a fresh `building`
    // lineup for this worker.
    await archiveActiveLineup(token);
    const { id } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        },
        workerPrefix,
    );
    return id;
}

// ROK-1147: initialise per-worker prefix + title before any describe-level
// `beforeAll` hooks run.
test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
});

// ---------------------------------------------------------------------------
// "Start Lineup" button visibility on Games page
// ---------------------------------------------------------------------------

test.describe('Start Lineup button on Games page', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
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
                body: JSON.stringify({ title: lineupTitle }),
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
        // ROK-1167: use the test-mode query param to open the modal directly.
        // Avoids racing on the global "no active lineup" banner state — sibling
        // workers may hold their own lineups, masking the Start Lineup button.
        await page.goto('/games?test=open-lineup-modal');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Modal should open with duration configuration fields
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

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
        // ROK-1167: pre-archive this worker's prior lineups so the POST inside
        // the modal succeeds (sibling-worker rows are scoped out by prefix).
        await archiveActiveLineup(adminToken);

        // ROK-1167: open the modal via test query param — no race on global banner.
        await page.goto('/games?test=open-lineup-modal');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

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
            page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
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

        // Click through to lineup detail via banner link.
        // ROK-1167: scope to .first() — under parallel CI load, OtherActiveLineups
        // (rendered below the banner) shows sibling workers' lineups as additional
        // matching links, breaking strict mode. The primary banner link is first
        // in DOM order.
        const bannerLink = page
            .getByRole('link', { name: /View Lineup|Lineup/i })
            .first();
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
                page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
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
                page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
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
                page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
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

// ROK-1060: removed the "Admin lineup duration settings" describe block —
// the admin panel and route have been deleted. New negative-assertion
// coverage lives in scripts/smoke/admin-lineup-defaults-removal.smoke.spec.ts.
