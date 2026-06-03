/**
 * Operator phase-transition smoke tests (ROK-946 / modal-flow ROK-1123,
 * migrated to the operator ⋮ menu in ROK-1323).
 *
 * The 4-phase breadcrumb was removed when the legacy detail-page chrome was
 * stripped; its idx±1 advance/revert capability moved into the operator `⋮`
 * menu (LineupOperatorMenu). These tests now drive that menu:
 * - The menu offers "Advance to {next}" / "Revert to {prev}" items, gated
 *   to the adjacent phases (terminal/first phases disable the respective item).
 * - Clicking an item opens the same PhaseTransitionModal whose title names the
 *   target phase ("Advance to Voting?", "Revert to Nominating?", etc.).
 * - Confirming executes the transition (verified via API — the status badge
 *   was removed with the legacy chrome).
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
    // ROK-1323: legacy H1 title removed — the title now renders in the composite
    // JourneyHero (or the fallback header for no-composite states).
    await expect(
        page.getByText(/Smoke Lineup|Lineup — /).first(),
    ).toBeVisible({ timeout: 10_000 });
}

/** Open the operator ⋮ menu (ROK-1323 — replaces the phase breadcrumb). */
async function openOperatorMenu(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
    await page.getByTestId('lineup-operator-menu-trigger').click();
    await expect(page.getByTestId('lineup-operator-menu')).toBeVisible({ timeout: 5_000 });
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

test.describe('Operator ⋮ menu — phase transition items', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('building: menu offers "Advance to Voting"; Revert is disabled', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);
            await openOperatorMenu(page);

            // Advance to the next phase (Voting) is offered + enabled.
            const advance = page.getByTestId('lineup-operator-menu-advance');
            await expect(advance).toBeVisible({ timeout: 3_000 });
            await expect(advance).toContainText(/Advance to Voting/i);
            await expect(advance).toBeEnabled();

            // Revert has no previous phase from building → disabled.
            await expect(page.getByTestId('lineup-operator-menu-revert')).toBeDisabled();
        }).toPass({ timeout: 30_000 });
    });

    test('voting: menu offers "Revert to Nominating"', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);
            await openOperatorMenu(page);

            const revert = page.getByTestId('lineup-operator-menu-revert');
            await expect(revert).toBeVisible({ timeout: 3_000 });
            await expect(revert).toContainText(/Revert to Nominating/i);
            await expect(revert).toBeEnabled();
        }).toPass({ timeout: 30_000 });
    });
});

// ---------------------------------------------------------------------------
// Advance flow (building → voting)
// ---------------------------------------------------------------------------

test.describe('Operator ⋮ menu — advance', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('Advance item opens the transition modal with target phase title', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);
            await openOperatorMenu(page);
            await page.getByTestId('lineup-operator-menu-advance').click();
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 });
            await expect(page.getByRole('heading', { name: /Advance to Voting\?/ })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('confirm executes advance to voting', async ({ page }) => {
        let lineupId = 0;
        await expect(async () => {
            lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);

            await openOperatorMenu(page);
            await page.getByTestId('lineup-operator-menu-advance').click();
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 });
            await page.getByRole('button', { name: /^Advance to Voting$/ }).click();
            await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
        }).toPass({ timeout: 30_000 });

        // Status persisted to voting (badge removed with the legacy chrome —
        // verify via API).
        await expect(async () => {
            const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
            expect(detail?.status).toBe('voting');
        }).toPass({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Revert flow (voting → building)
// ---------------------------------------------------------------------------

test.describe('Operator ⋮ menu — revert', () => {
    // Revert tests need extra time — ensureLineupInPhase does 2+ API calls per retry
    test.setTimeout(60_000);

    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('Revert item opens the transition modal with target phase title', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);
            await openOperatorMenu(page);
            await page.getByTestId('lineup-operator-menu-revert').click();
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
            await expect(page.getByRole('heading', { name: /Revert to Nominating\?/ })).toBeVisible({ timeout: 10_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('confirm executes revert to building', async ({ page }) => {
        let lineupId = 0;
        await expect(async () => {
            lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);

            await openOperatorMenu(page);
            await page.getByTestId('lineup-operator-menu-revert').click();
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^Revert to Nominating$/ }).click();
            await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
        }).toPass({ timeout: 30_000 });

        await expect(async () => {
            const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
            expect(detail?.status).toBe('building');
        }).toPass({ timeout: 10_000 });
    });

    test('revert from decided back to voting', async ({ page }) => {
        let lineupId = 0;
        await expect(async () => {
            lineupId = await ensureLineupInPhase(adminToken, 'decided');
            await gotoLineupDetail(page, lineupId);

            await openOperatorMenu(page);
            await page.getByTestId('lineup-operator-menu-revert').click();
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
            await page.getByRole('button', { name: /^Revert to Voting$/ }).click();
            await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
        }).toPass({ timeout: 30_000 });

        await expect(async () => {
            const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
            expect(detail?.status).toBe('voting');
        }).toPass({ timeout: 10_000 });
    });
});

