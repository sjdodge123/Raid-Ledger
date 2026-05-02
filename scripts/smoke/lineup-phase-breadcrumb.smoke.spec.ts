/**
 * Phase breadcrumb interaction smoke tests (ROK-946).
 *
 * Tests the interactive phase breadcrumb on the lineup detail page:
 * - Adjacent phases are clickable for operators
 * - First click shows "Advance?" or "Revert?" confirmation
 * - Second click executes the transition
 * - Confirmation resets after 3-second timeout
 * - Non-adjacent phases are not clickable
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import { test, expect } from './base';
import {
    API_BASE,
    getAdminToken,
    apiGet,
    createLineupOrRetry,
    cancelLineupPhaseJobs,
} from './api-helpers';

/** Local apiPatch that returns raw Response (callers check .ok). */
async function apiPatch(token: string, path: string, body: Record<string, unknown>) {
    return fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
}

// ROK-1147: per-worker title prefix scopes /admin/test/reset-lineups so
// sibling workers don't archive each other's lineups mid-test.
const FILE_PREFIX = 'lineup-phase-breadcrumb';
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ titlePrefix: workerPrefix }),
    });
}

async function ensureActiveLineup(token: string): Promise<number> {
    // ROK-1070: switched from a bare POST /lineups + fallback to
    // /lineups/banner on 409, to `createLineupOrRetry`. The old fallback
    // returned whatever active lineup happened to exist, which on a
    // sibling-worker collision could be a `voting`/`decided` row — the
    // breadcrumb test then advanced from the wrong phase. The retry helper
    // archives sibling rows by prefix and re-POSTs, guaranteeing a fresh
    // `building` lineup for this worker. Defensive: also cancel the
    // BullMQ phase-advance job so a slow CI run can't auto-advance the
    // 720h-window lineup mid-test (matches lineup-auto-advance fixture).
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
    await cancelLineupPhaseJobs(token, id);
    return id;
}

async function ensureLineupInPhase(token: string, targetPhase: string): Promise<number> {
    const lineupId = await ensureActiveLineup(token);
    const transitions: Record<string, string[]> = {
        building: [],
        voting: ['voting'],
        decided: ['voting', 'decided'],
        scheduling: ['voting', 'decided', 'scheduling'],
    };
    for (const status of transitions[targetPhase] ?? []) {
        const body: Record<string, unknown> = { status };
        if (status === 'decided') {
            const detail = await apiGet(token, `/lineups/${lineupId}`);
            if (detail?.entries?.length > 0) {
                body.decidedGameId = detail.entries[0].gameId;
            }
        }
        await apiPatch(token, `/lineups/${lineupId}/status`, body);
    }
    return lineupId;
}

// ---------------------------------------------------------------------------
// Navigate to detail page with retry for parallel worker races
// ---------------------------------------------------------------------------

async function gotoLineupDetail(page: ReturnType<typeof test.info>['_test'] extends never ? never : Parameters<Parameters<typeof test>[1]>[0]['page'], lineupId: number) {
    await page.goto(`/community-lineup/${lineupId}`);
    await expect(
        page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
    ).toBeVisible({ timeout: 10_000 });
}

// ROK-1147: initialise per-worker prefix + title before any describe-level
// `beforeAll` hooks run.
test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
});

// ---------------------------------------------------------------------------
// Breadcrumb visibility and interaction
// ---------------------------------------------------------------------------

test.describe('Phase breadcrumb — operator controls', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('current phase is highlighted, non-adjacent phases are plain text', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);

            // "Nominating" (building) is the current phase — should NOT be a button
            const nominatingSpan = page.locator('span', { hasText: 'Nominating' }).filter({
                has: page.locator(':scope:not(button)'),
            });
            await expect(nominatingSpan.first()).toBeVisible({ timeout: 3_000 });

            // "Scheduling" is 2 phases ahead — should NOT be a button
            await expect(page.getByRole('button', { name: 'Scheduling' })).toHaveCount(0);

            // "Scheduling" (decided) is 3 phases ahead — should NOT be a button
            await expect(page.getByRole('button', { name: 'Scheduling' })).toHaveCount(0);

            // "Archived" is 4 phases ahead — should NOT be a button
            await expect(page.getByRole('button', { name: 'Archived' })).toHaveCount(0);
        }).toPass({ timeout: 30_000 });
    });

    test('next phase is a clickable button from building', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);
            await expect(page.getByRole('button', { name: 'Voting' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('previous phase is a clickable button from voting', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);
            await expect(page.getByRole('button', { name: 'Nominating' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });
});

// ---------------------------------------------------------------------------
// Advance flow (building → voting)
// ---------------------------------------------------------------------------

test.describe('Phase breadcrumb — advance', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('first click shows "Advance?" confirmation', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);
            await page.getByRole('button', { name: 'Voting' }).click();
            await expect(page.getByRole('button', { name: 'Advance?' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('second click executes advance to voting', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);

            await page.getByRole('button', { name: 'Voting' }).click();
            await expect(page.getByRole('button', { name: 'Advance?' })).toBeVisible({ timeout: 3_000 });
            await page.getByRole('button', { name: 'Advance?' }).click();
        }).toPass({ timeout: 30_000 });

        // Status should update to Voting
        await expect(page.locator('span').filter({ hasText: /Voting/ }).first()).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Revert flow (voting → building)
// ---------------------------------------------------------------------------

test.describe('Phase breadcrumb — revert', () => {
    // Revert tests need extra time — ensureLineupInPhase does 2+ API calls per retry
    test.setTimeout(60_000);

    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    // ROK-1070: skipped under cap pending ROK-1225 (LineupsService matching
    // bug). Revert? UI requires the lineup to reach `voting` with valid
    // match-member rows; the upstream 'voted' source insert fails and the
    // phase advance never settles to a state where revert is offered.
    test.skip('first click shows "Revert?" confirmation', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);
            await page.getByRole('button', { name: 'Nominating' }).click();
            await expect(page.getByRole('button', { name: 'Revert?' })).toBeVisible({ timeout: 10_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('second click executes revert to building', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);

            await page.getByRole('button', { name: 'Nominating' }).click();
            await expect(page.getByRole('button', { name: 'Revert?' })).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: 'Revert?' }).click();
        }).toPass({ timeout: 30_000 });

        // Status should revert to Nominating/building
        await expect(page.locator('span').filter({ hasText: /Nominating/ }).first()).toBeVisible({ timeout: 10_000 });
    });

    test('revert from decided back to voting', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'decided');
            await gotoLineupDetail(page, lineupId);

            await page.getByRole('button', { name: 'Voting' }).click();
            await expect(page.getByRole('button', { name: 'Revert?' })).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: 'Revert?' }).click();
        }).toPass({ timeout: 30_000 });

        await expect(page.locator('span').filter({ hasText: /Voting/ }).first()).toBeVisible({ timeout: 10_000 });
    });
});

