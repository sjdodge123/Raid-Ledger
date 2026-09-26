/**
 * Lineup auto-advance live UI refresh smoke test (ROK-1118).
 *
 * AC: when the lineup phase changes, a user already on the detail page must
 * see the phase surface update — no navigation required.
 *
 * Strategy: open the detail page in a Playwright page (User B). Trigger a
 * phase transition via the REST API from the test runner (User A). Assert
 * that the per-phase composite on User B's already-open page swaps from
 * VotingComposite to the decided composite (ROK-1323 replaced the old
 * LineupStatusBadge with these per-phase surfaces).
 *
 * What it guards: the LineupsGateway + the useLineupRealtime hook. Without
 * them the page only refetches every 30s, so the composite would not swap
 * on its own and this assertion fails.
 *
 * Determinism (ROK-1150 #3): never use sleep(), and never judge the UI
 * against a wall-clock guess at how long the server takes. The PATCH that
 * drives voting → decided returns before its side-effects settle, so the
 * shape is poll-then-assert: first `waitForLineupStatus` polls
 * `GET /lineups/:id` until the server itself reports `decided` (the
 * deterministic anchor), and only THEN do we assert the UI swap with a
 * single generous budget measured from that confirmed transition. The
 * assertion still proves live delivery — the page is never reloaded or
 * navigated between the PATCH and the assertion, so the composite can only
 * swap via the `lineup:status` socket event + query invalidation.
 *
 * Why: against the remote fleet (https://slot-N.gamernight.net) the old
 * 5s window failed on both desktop and mobile while passing on localhost
 * and GitHub CI — the extra network hop pushed the server-side transition
 * itself past the budget, so the test was timing the API, not the socket.
 * See TECH-DEBT-BACKLOG.md (ROK-1150).
 */
import { test, expect } from './base';
import {
    getAdminToken,
    apiGet,
    apiPatch,
    apiPost,
    createLineupOrRetry,
    waitForLineupStatus,
} from './api-helpers';

// ROK-1147: per-worker title prefix scopes /admin/test/reset-lineups so this
// spec only ever archives ITS OWN lineups — never a sibling worker's.
const FILE_PREFIX = 'lineup-auto-advance';
let workerPrefix: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Archive THIS worker's lineups so the next create starts clean.
 *
 * It used to read `/lineups/banner` and drive whatever it returned to
 * `archived` — a sibling worker's lineup (e.g. lineup-empty-participation's)
 * mid-test. The prefix-scoped reset leaves other workers' rows alone.
 * `decided` is included because a finished run leaves our lineup there.
 */
async function archiveActiveLineup(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
        phases: ['building', 'voting', 'decided'],
    });
}

/**
 * Create a lineup parked in `voting` status so the live transition we want
 * to observe is voting → decided (user-facing label flip "Voting" →
 * "Scheduling").
 */
async function createVotingLineup(token: string): Promise<{
    lineupId: number;
    decidedGameId: number;
}> {
    await archiveActiveLineup(token);

    // Pull a couple of game IDs to nominate.
    const games = await apiGet(token, '/admin/settings/games');
    const gameIds = (games?.data?.slice(0, 2) ?? []).map(
        (g: { id: number }) => g.id,
    );
    if (gameIds.length < 2) {
        throw new Error('Demo data missing — need at least 2 configured games');
    }

    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: `${workerPrefix}Auto Advance Smoke`,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        },
        workerPrefix,
    );

    for (const gid of gameIds) {
        await apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid });
    }
    await apiPatch(token, `/lineups/${lineupId}/status`, { status: 'voting' });

    return { lineupId, decidedGameId: gameIds[0] };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Lineup live UI refresh (ROK-1118)', () => {
    let adminToken: string;
    let lineupId: number;
    let decidedGameId: number;

    test.beforeAll(async ({}, testInfo) => {
        workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
        adminToken = await getAdminToken();
        const ctx = await createVotingLineup(adminToken);
        lineupId = ctx.lineupId;
        decidedGameId = ctx.decidedGameId;
    });

    test('phase composite swaps Voting → Decided on the open page without navigation', async ({
        page,
    }) => {
        // ROK-1533: the whole lineup smoke family shares ONE global active
        // lineup by construction (POST /lineups 409s while one is active), and
        // sibling specs archive whatever lineup currently holds the banner. On
        // the fleet — one env serving desktop + mobile + every other lane — a
        // fixture built once in `beforeAll` can therefore be archived, or
        // already advanced by an earlier repeat, before this test transitions
        // it. Re-establish OUR lineup in `voting` when that has happened, and
        // retry the open → transition → observe window as a unit.
        //
        // Nothing below is weakened: each attempt still opens the page BEFORE
        // the transition, still never navigates after it, and still holds the
        // same 15s live-refresh budget measured from the confirmed server-side
        // transition. Only the window is retried.
        test.setTimeout(150_000);
        let votingComposite = page.getByTestId('voting-composite');

        await expect(async () => {
            const detail = (await apiGet(adminToken, `/lineups/${lineupId}`)) as {
                status?: string;
            } | null;
            if (detail?.status !== 'voting') {
                const ctx = await createVotingLineup(adminToken);
                lineupId = ctx.lineupId;
                decidedGameId = ctx.decidedGameId;
            }

            // User B opens the detail page while the lineup is in voting phase.
            await page.goto(`/community-lineup/${lineupId}`);
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 10_000 },
            );

            // ROK-1323: the status badge was removed. The per-phase composite is
            // the live phase indicator — voting renders VotingComposite.
            votingComposite = page.getByTestId('voting-composite');
            await expect(votingComposite).toBeVisible({ timeout: 15_000 });

            // User A advances the phase via REST. User B does NOT navigate.
            await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
                status: 'decided',
                decidedGameId,
            });

            // Deterministic anchor: confirm the server-side transition actually
            // landed before judging the UI. Without this the assertion below is
            // really timing the API round-trip plus its async side-effects, which
            // is exactly what made this test fleet-only flaky (ROK-1150 #3).
            await waitForLineupStatus(adminToken, lineupId, 'decided');

            // Measured from the confirmed transition: the `lineup:status` socket
            // event + query invalidation must swap the voting composite for the
            // decided composite on the still-open page. No reload, no navigation.
            await expect(
                page.getByTestId('decided-composite-view'),
            ).toBeVisible({ timeout: 15_000 });
        }).toPass({ timeout: 120_000, intervals: [1_000] });

        // And the old voting composite must be gone.
        await expect(votingComposite).not.toBeVisible({ timeout: 2_000 });
    });
});
