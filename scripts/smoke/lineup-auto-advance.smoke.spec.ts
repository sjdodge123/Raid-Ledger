/**
 * Lineup auto-advance live UI refresh smoke test (ROK-1118).
 *
 * AC: when the lineup phase changes, a user already on the detail page must
 * see the LineupStatusBadge update within seconds — no navigation required.
 *
 * Strategy: open the detail page in a Playwright page (User B). Trigger a
 * phase transition via the REST API from the test runner (User A). Assert
 * that the badge text on User B's already-open page flips from "Voting" to
 * "Scheduling" (the user-facing label for the `decided` status — see
 * web/src/components/lineups/LineupStatusBadge.tsx).
 *
 * TDD gate: this test fails today. Without the LineupsGateway + the
 * useLineupRealtime hook the page only refetches every 30s, so the badge
 * does NOT update within the 5-second window. The dev agent's job is to
 * make this assertion pass.
 *
 * Determinism: never use sleep(). We rely on Playwright's auto-retrying
 * `expect(...).toBeVisible({ timeout })` to poll until the badge text
 * updates or the timeout window elapses.
 */
import { test, expect } from './base';
import { getAdminToken, apiGet, apiPatch, apiPost } from './api-helpers';

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

    test('badge flips Voting → Scheduling within 5s without navigation', async ({
        page,
    }) => {
        // User B opens the detail page while the lineup is in voting phase.
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // The badge must be in Voting state initially.
        const votingBadge = page
            .locator('span')
            .filter({ hasText: /^Voting$/ })
            .first();
        await expect(votingBadge).toBeVisible({ timeout: 15_000 });

        // User A advances the phase via REST. User B does NOT navigate.
        await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
            status: 'decided',
            decidedGameId,
        });

        // User B's still-open page should reflect the new status within 5s
        // courtesy of the `lineup:status` socket event + query invalidation.
        // NOTE: 'decided' renders as label "Scheduling" — see
        // web/src/components/lineups/LineupStatusBadge.tsx.
        const scheduledBadge = page
            .locator('span')
            .filter({ hasText: /^Scheduling$/ })
            .first();
        await expect(scheduledBadge).toBeVisible({ timeout: 5_000 });

        // And the old badge must be gone.
        await expect(votingBadge).not.toBeVisible({ timeout: 1_000 });
    });
});
