/**
 * Lineup empty-participation edge-case smoke (ROK-1069).
 *
 * Covers the case where a lineup advances to `voting` with zero
 * nominations:
 *   - Detail page still renders without an error boundary.
 *   - Status badge shows `Voting`.
 *   - The Abort button is still visible to the operator (so a stuck
 *     lineup can be ended manually).
 *   - The page does NOT crash on the empty entries array.
 *
 * Per-worker title-prefix isolation (ROK-1147 pattern) keeps sibling
 * Playwright workers from racing each other on the global "active
 * lineup" UI.
 */
import { test, expect } from './base';
import {
    apiPost,
    apiGet,
    awaitProcessing,
    cancelLineupPhaseJobs,
    createLineupOrRetry,
    getAdminToken,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-empty-participation';
let workerPrefix: string;
let lineupTitle: string;

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Empty Participation`;
});

/** Archive this worker's prior lineups so a fresh `building` row can be created. */
async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

/**
 * Create a lineup, cancel its scheduled phase jobs (so auto-advance does
 * not race the test), then force it into `voting` with zero nominations.
 */
async function createEmptyVotingLineup(token: string): Promise<number> {
    await resetWorkerLineups(token);
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
    await apiPost(token, '/admin/test/lineup/advance-with-zero-noms', {
        lineupId: id,
    });
    await awaitProcessing(token);
    return id;
}

test.describe('Lineup empty-participation edge case', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        lineupId = await createEmptyVotingLineup(adminToken);
    });

    test('voting lineup with zero nominations renders without crash', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // ROK-1323: an empty voting lineup renders LineupEmptyState (no
        // composite hero), so the title comes from the fallback LineupHeroMeta
        // in the compact header.
        await expect(
            page.getByText(/Empty Participation|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });

        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        expect(detail?.status).toBe('voting');
        expect(detail?.entries).toEqual([]);
        // Status badge was removed with the legacy chrome; phase is asserted via
        // the API above (no UI badge on an empty-voting lineup).
    });

    test('admin abort button remains available on empty voting lineup', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // ROK-1323: Abort moved into the operator ⋮ menu; still available to
        // an operator on a non-archived (voting) lineup.
        await page.getByTestId('lineup-operator-menu-trigger').click();
        await expect(
            page.getByTestId('lineup-operator-menu-abort'),
        ).toBeVisible({ timeout: 15_000 });
    });
});
