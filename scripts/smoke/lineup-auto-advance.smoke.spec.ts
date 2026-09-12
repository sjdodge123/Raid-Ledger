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
    waitForLineupStatus,
} from './api-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cancel pending BullMQ phase-transition jobs for a lineup (ROK-1007). */
async function cancelPhaseJobs(token: string, id: number): Promise<void> {
    await apiPost(token, '/admin/test/cancel-lineup-phase-jobs', { lineupId: id });
}

/**
 * Drive any active lineup all the way to archived so the next create call
 * starts from a clean slate.
 */
async function archiveActiveLineup(token: string): Promise<void> {
    const banner = await apiGet(token, '/lineups/banner');
    if (!banner || typeof banner.id !== 'number') return;
    await cancelPhaseJobs(token, banner.id);
    const detail = await apiGet(token, `/lineups/${banner.id}`);
    if (!detail) return;
    const transitions: Record<string, string[]> = {
        building: ['voting', 'decided', 'archived'],
        voting: ['decided', 'archived'],
        decided: ['archived'],
    };
    const steps = transitions[detail.status] ?? [];
    for (const status of steps) {
        const body: Record<string, unknown> = { status };
        if (status === 'decided' && detail.entries?.length > 0) {
            body.decidedGameId = detail.entries[0].gameId;
        }
        await apiPatch(token, `/lineups/${banner.id}/status`, body);
    }
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

    const created = (await apiPost(token, '/lineups', {
        title: 'Auto Advance Smoke',
        buildingDurationHours: 720,
        votingDurationHours: 720,
        decidedDurationHours: 720,
    })) as { id: number };
    const lineupId = created.id;

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

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        const ctx = await createVotingLineup(adminToken);
        lineupId = ctx.lineupId;
        decidedGameId = ctx.decidedGameId;
    });

    test('phase composite swaps Voting → Decided on the open page without navigation', async ({
        page,
    }) => {
        // User B opens the detail page while the lineup is in voting phase.
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // ROK-1323: the status badge was removed. The per-phase composite is
        // the live phase indicator — voting renders VotingComposite.
        const votingComposite = page.getByTestId('voting-composite');
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

        // And the old voting composite must be gone.
        await expect(votingComposite).not.toBeVisible({ timeout: 2_000 });
    });
});
