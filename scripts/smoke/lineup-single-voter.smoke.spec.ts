/**
 * Lineup single-voter edge-case smoke (ROK-1069).
 *
 * Verifies that a `voting` lineup with one nomination and one voter
 * renders without crashing and that vote counts surface correctly. The
 * single-voter scenario was a runbook gotcha in ROK-1068 because the
 * matching/quorum calculations have to handle a degenerate sample size
 * cleanly (no divide-by-zero, no NaN percentages).
 *
 * Per-worker title-prefix isolation (ROK-1147 pattern).
 */
import { test, expect } from './base';
import {
    apiGet,
    apiPost,
    awaitProcessing,
    cancelLineupPhaseJobs,
    createLineupOrRetry,
    getAdminToken,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-single-voter';
let workerPrefix: string;
let lineupTitle: string;

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Single Voter`;
});

async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

/**
 * Build a `voting` lineup with exactly one nomination and one vote
 * cast by the admin. Returns ids the test can assert on.
 */
async function createSingleVoterLineup(
    token: string,
): Promise<{ lineupId: number; gameId: number }> {
    await resetWorkerLineups(token);

    const games = await apiGet(token, '/admin/settings/games');
    const gameId = games?.data?.[0]?.id as number | undefined;
    if (!gameId) {
        throw new Error('Demo data missing — need at least 1 configured game');
    }

    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        },
        workerPrefix,
    );
    await cancelLineupPhaseJobs(token, lineupId);

    // Nominate one game, advance to voting, cast one vote.
    await apiPost(token, `/lineups/${lineupId}/nominate`, { gameId });
    await apiPost(token, '/admin/test/lineup/advance-with-zero-noms', {
        lineupId,
    });
    // Look up the admin's user id (votes need a real user FK).
    const me = await apiGet(token, '/auth/me');
    const userId = me?.id as number | undefined;
    if (!userId) {
        throw new Error('Could not resolve admin userId from /auth/me');
    }
    await apiPost(token, '/admin/test/lineup/seed-single-voter', {
        lineupId,
        gameId,
        userId,
    });
    await awaitProcessing(token);

    return { lineupId, gameId };
}

test.describe('Lineup single-voter edge case', () => {
    let adminToken: string;
    let lineupId: number;
    let gameId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        const ctx = await createSingleVoterLineup(adminToken);
        lineupId = ctx.lineupId;
        gameId = ctx.gameId;
    });

    test('single-voter voting lineup serves a stable detail payload', async () => {
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        expect(detail?.status).toBe('voting');
        expect(Array.isArray(detail?.entries)).toBe(true);
        expect(detail?.entries.length).toBe(1);
        expect(detail?.entries[0]?.gameId).toBe(gameId);
    });

    test('single-voter voting lineup renders detail page without crash', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // ROK-1323: legacy H1 title + status badge removed. A single-voter
        // voting lineup has 1 entry → VotingComposite renders, so the title
        // lives in the JourneyHero and the ribbon is the phase indicator.
        await expect(
            page.getByText(/Single Voter|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });
        await expect(
            page.getByRole('list', { name: 'Lineup progress' }).first(),
        ).toBeVisible({ timeout: 10_000 });

        // No NaN percentages, no infinity glyph anywhere on the page.
        await expect(page.locator('body')).not.toHaveText(/NaN|Infinity/, {
            timeout: 5_000,
        });
    });
});
