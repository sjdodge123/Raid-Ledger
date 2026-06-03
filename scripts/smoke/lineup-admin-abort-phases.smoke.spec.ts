/**
 * Lineup admin-abort-from-each-phase smoke (ROK-1069).
 *
 * Sibling to `lineup-abort.smoke.spec.ts`. The original spec only
 * covered abort from `building`; ROK-1068's runbook called out the
 * other phases as edge cases the operator regularly hits.
 *
 * For each of `building`, `voting`, `decided`:
 *   1. Stand up a lineup, drive to the target phase via PATCH /status,
 *      cancelling auto-advance jobs first so the phase doesn't drift.
 *   2. Hit POST /lineups/:id/abort with a reason.
 *   3. Assert the row flips to `archived` and the abort button is gone
 *      from the detail page.
 *
 * Per-worker title-prefix isolation (ROK-1147 pattern). Mobile-friendly:
 * we drive phases via direct PATCH instead of breadcrumb-pill clicks,
 * since those race on mobile rendering (planner gotcha).
 */
import { test, expect } from './base';
import {
    API_BASE,
    apiGet,
    apiPatch,
    apiPost,
    awaitProcessing,
    cancelLineupPhaseJobs,
    createLineupOrRetry,
    getAdminToken,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-admin-abort-phases';
let workerPrefix: string;
let lineupTitleBase: string;

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitleBase = `${workerPrefix}Abort Phases`;
});

async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

interface DriveOpts {
    target: 'building' | 'voting' | 'decided';
    phaseSuffix: string;
}

/**
 * Stand up a fresh lineup pinned to `target` phase. Cancels phase jobs
 * up front so the auto-advance scheduler does not race the test.
 */
async function createLineupInPhase(
    token: string,
    opts: DriveOpts,
): Promise<{ id: number; gameId: number }> {
    await resetWorkerLineups(token);

    const games = await apiGet(token, '/admin/settings/games');
    const gameId = games?.data?.[0]?.id as number | undefined;
    if (!gameId) {
        throw new Error('Demo data missing — need at least 1 configured game');
    }

    const { id } = await createLineupOrRetry(
        token,
        {
            title: `${lineupTitleBase} ${opts.phaseSuffix}`,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        },
        workerPrefix,
    );
    await cancelLineupPhaseJobs(token, id);

    if (opts.target === 'voting' || opts.target === 'decided') {
        await apiPost(token, `/lineups/${id}/nominate`, { gameId });
        await apiPatch(token, `/lineups/${id}/status`, { status: 'voting' });
    }
    if (opts.target === 'decided') {
        await apiPatch(token, `/lineups/${id}/status`, {
            status: 'decided',
            decidedGameId: gameId,
        });
    }
    await awaitProcessing(token);
    return { id, gameId };
}

async function abortViaApi(token: string, lineupId: number): Promise<number> {
    const res = await fetch(`${API_BASE}/lineups/${lineupId}/abort`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reason: `Smoke abort from phase` }),
    });
    return res.status;
}

for (const phase of ['building', 'voting', 'decided'] as const) {
    test.describe(`Admin abort from ${phase}`, () => {
        let adminToken: string;
        let lineupId: number;

        test.beforeAll(async () => {
            adminToken = await getAdminToken();
            const ctx = await createLineupInPhase(adminToken, {
                target: phase,
                phaseSuffix: phase,
            });
            lineupId = ctx.id;
        });

        test(`POST /lineups/:id/abort succeeds and flips status to archived`, async () => {
            const before = await apiGet(adminToken, `/lineups/${lineupId}`);
            expect(before?.status).toBe(phase);

            const status = await abortViaApi(adminToken, lineupId);
            expect(status).toBe(200);
            await awaitProcessing(adminToken);

            const after = await apiGet(adminToken, `/lineups/${lineupId}`);
            expect(after?.status).toBe('archived');
        });

        test(`detail page hides the Abort button after archive`, async ({
            page,
        }) => {
            await page.goto(`/community-lineup/${lineupId}`);
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 10_000 },
            );
            await expect(
                page.getByText(/Abort Phases|Lineup — /).first(),
            ).toBeVisible({ timeout: 15_000 });

            // ROK-1323: Abort moved into the operator ⋮ menu and the legacy
            // status badge was removed. On an archived lineup the operator menu
            // still opens but the Abort item is gated out — that absence is the
            // post-archive signal (status already asserted via API above).
            await expect(
                page.getByRole('button', { name: /Abort Lineup/i }),
            ).toHaveCount(0);
            await page.getByTestId('lineup-operator-menu-trigger').click();
            await expect(
                page.getByTestId('lineup-operator-menu-abort'),
            ).toHaveCount(0);
        });
    });
}
