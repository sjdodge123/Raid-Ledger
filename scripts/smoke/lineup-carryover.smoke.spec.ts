/**
 * Lineup carryover edge-case smoke (ROK-1068).
 *
 * ROK-937 introduced the auto-carryover behaviour: when a new lineup is
 * created, any game with a `suggested` match on the most recent decided
 * (or archived) PUBLIC lineup is copied forward as a pre-populated
 * nomination on the new lineup, carrying the original nominator and a
 * `carriedOverFrom` back-reference.
 *
 * Existing coverage prior to ROK-1068:
 *   - `lineup-decided.smoke.spec.ts` has a passive "if the carried-forward
 *     section is visible, expect chip count > 0" check that never actually
 *     drives the carryover path.
 *   - `lineups-matches.integration.spec.ts` exercises the helper end-to-end
 *     against the test DB, but no smoke spec exists.
 *
 * This spec drives the full flow against the live API:
 *   1. Stand up a "previous" public lineup (lineup A) with two games,
 *      seed two distinct voters via the DEMO_MODE-only helper so that
 *      each game ends with 1/2 = 50% — under matchThreshold=60 both
 *      games become `status='suggested'` matches.
 *   2. Walk A through voting → decided → archived.
 *   3. POST /lineups (lineup B) and assert at least one entry on B
 *      has `carriedOver === true`. The full integration test asserts
 *      `carriedOverFrom` and game-id parity; smoke asserts the
 *      user-visible flag.
 *
 * Per-worker title-prefix isolation (ROK-1147 pattern) — the suite never
 * touches sibling-worker lineups, so concurrent Playwright projects
 * (desktop + mobile) can run this file in parallel.
 */
import { test, expect } from './base';
import {
    apiGet,
    apiPatch,
    apiPost,
    awaitProcessing,
    cancelLineupPhaseJobs,
    createLineupOrRetry,
    getAdminToken,
    waitForLineupStatus,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-carryover';
let workerPrefix: string;
let priorLineupTitle: string;
let newLineupTitle: string;

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    priorLineupTitle = `${workerPrefix}Prior Decided`;
    newLineupTitle = `${workerPrefix}Fresh Lineup`;
});

async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

/** Pull two existing user ids from the admin /users endpoint. */
async function fetchTwoUserIds(token: string): Promise<[number, number]> {
    const res = await apiGet(token, '/users?limit=10');
    const list = (res?.data ?? []) as { id: number }[];
    if (list.length < 2) {
        throw new Error(
            `Need at least 2 demo users to drive the carryover flow; found ${list.length}`,
        );
    }
    return [list[0].id, list[1].id];
}

async function fetchTwoGameIds(token: string): Promise<[number, number]> {
    const games = await apiGet(token, '/admin/settings/games');
    const ids = (games?.data ?? []).slice(0, 2).map((g: { id: number }) => g.id);
    if (ids.length < 2) {
        throw new Error('Demo data missing — need at least 2 configured games');
    }
    return [ids[0], ids[1]];
}

/**
 * Build a decided-and-archived lineup with two `suggested` matches so the
 * carryover helper has something to copy forward.
 *
 * Match threshold=60 + 1 vote/game + 2 distinct voters → each game lands
 * at 50% → both classified `suggested` instead of `scheduling`.
 */
async function buildPriorDecidedLineup(token: string): Promise<{
    lineupId: number;
    gameIds: [number, number];
}> {
    await resetWorkerLineups(token);

    const gameIds = await fetchTwoGameIds(token);
    const [voterA, voterB] = await fetchTwoUserIds(token);

    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: priorLineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 60,
        },
        workerPrefix,
    );
    await cancelLineupPhaseJobs(token, lineupId);

    for (const gid of gameIds) {
        await apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid });
    }

    // Force into voting (skips the "needs ≥N nominations" guard).
    await apiPost(token, '/admin/test/lineup/advance-with-zero-noms', {
        lineupId,
    });

    // Seed one vote per game from two distinct users so totalVoters=2 and
    // each game ends with 1/2 = 50% (below threshold=60 → suggested).
    await apiPost(token, '/admin/test/lineup/seed-single-voter', {
        lineupId,
        gameId: gameIds[0],
        userId: voterA,
    });
    await apiPost(token, '/admin/test/lineup/seed-single-voter', {
        lineupId,
        gameId: gameIds[1],
        userId: voterB,
    });

    // Walk voting → decided. decidedGameId can be either game; we pick the
    // first nomination so the API guard passes.
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'decided',
        decidedGameId: gameIds[0],
    });
    await awaitProcessing(token);

    // Archive so the next /lineups POST runs carryover against this row.
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'archived',
    });
    // ROK-1286: the archive PATCH and its async side-effects settle out of
    // band. The carryover helper only copies forward from an ARCHIVED prior
    // row, so poll until the status is observably `archived` before returning
    // (replaces the prior fire-and-forget `awaitProcessing`, which drained the
    // queues but did NOT guarantee the status flip was visible to the next
    // /lineups POST under full-suite latency).
    await waitForLineupStatus(token, lineupId, 'archived');

    return { lineupId, gameIds };
}

test.describe('Lineup carryover edge case', () => {
    let adminToken: string;
    let priorLineupId: number;
    let priorGameIds: [number, number];
    let newLineupId: number;
    let carriedGameIds: number[];

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        const ctx = await buildPriorDecidedLineup(adminToken);
        priorLineupId = ctx.lineupId;
        priorGameIds = ctx.gameIds;
    });

    test('creating a new lineup auto-populates entries from prior decided suggested matches', async () => {
        const created = (await apiPost(adminToken, '/lineups', {
            title: newLineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        })) as { id?: number };
        if (!created?.id) {
            throw new Error(
                `Failed to create new lineup for carryover assertion: ${JSON.stringify(created).slice(0, 200)}`,
            );
        }
        newLineupId = created.id;
        await awaitProcessing(adminToken);

        const detail = await apiGet(adminToken, `/lineups/${newLineupId}`);
        expect(detail).toBeTruthy();
        expect(Array.isArray(detail.entries)).toBe(true);

        // The carryover helper should have copied at least one of the
        // prior lineup's suggested-match games forward with carriedOver=true.
        const carriedEntries = (detail.entries as Array<{
            gameId: number;
            carriedOver: boolean;
        }>).filter((e) => e.carriedOver === true);

        expect(carriedEntries.length).toBeGreaterThanOrEqual(1);
        carriedGameIds = carriedEntries.map((e) => e.gameId);

        // Sanity: the carried entry references one of the games the prior
        // lineup actually had. (Either game qualifies — both ended at
        // 50% under threshold=60.)
        const eitherPriorGameCarried =
            carriedGameIds.includes(priorGameIds[0]) ||
            carriedGameIds.includes(priorGameIds[1]);
        expect(eitherPriorGameCarried).toBe(true);

        // Hygiene: the prior lineup itself remains addressable for the
        // assertion message to be meaningful.
        const prior = await apiGet(adminToken, `/lineups/${priorLineupId}`);
        expect(prior?.status).toBe('archived');
    });

    /**
     * ROK-1274: drive the new lineup through voting → decided and verify
     * the decided-view chip strip actually renders. The bug fixed by 1274
     * was that `GroupedMatchesResponseDto.carriedForward` came back empty
     * even when entries existed, so `<CarriedForwardSection>` returned null.
     */
    test('decided-view renders the Carried Forward chip strip for the new lineup', async ({
        page,
    }) => {
        expect(newLineupId, 'prior test must have populated newLineupId').toBeTruthy();

        // Walk the new lineup voting → decided. The carryover helper has
        // already populated entries; bypass the "min noms" guard, seed a
        // single vote on one carried game so the lineup has a decidedGame
        // option, then advance.
        await cancelLineupPhaseJobs(adminToken, newLineupId);
        await apiPost(adminToken, '/admin/test/lineup/advance-with-zero-noms', {
            lineupId: newLineupId,
        });

        const [voterA] = await fetchTwoUserIds(adminToken);
        const decidedGameId = carriedGameIds[0];
        await apiPost(adminToken, '/admin/test/lineup/seed-single-voter', {
            lineupId: newLineupId,
            gameId: decidedGameId,
            userId: voterA,
        });

        await apiPatch(adminToken, `/lineups/${newLineupId}/status`, {
            status: 'decided',
            decidedGameId,
        });
        await awaitProcessing(adminToken);

        // API-level falsification: the chip-strip payload must be non-empty.
        const matches = await apiGet(
            adminToken,
            `/lineups/${newLineupId}/matches`,
        );
        expect(Array.isArray(matches?.carriedForward)).toBe(true);
        expect(matches.carriedForward.length).toBeGreaterThanOrEqual(1);

        // Browser-level: the chip strip + at least one chip must render.
        await page.goto(`/community-lineup/${newLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );
        await expect(
            page.locator('[data-testid="decided-composite-view"]'),
        ).toBeVisible({ timeout: 15_000 });

        const carriedSection = page.locator(
            '[data-testid="carried-forward-section"]',
        );
        await expect(carriedSection).toBeVisible({ timeout: 15_000 });

        const chips = carriedSection.locator(
            '[data-testid="carried-forward-chip"]',
        );
        const chipCount = await chips.count();
        expect(chipCount).toBeGreaterThanOrEqual(1);
    });
});
