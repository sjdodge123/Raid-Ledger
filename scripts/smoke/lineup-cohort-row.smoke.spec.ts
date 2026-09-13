/**
 * ROK-1538 — Playwright smoke for the Common Ground "Played with this group
 * before" row.
 *
 * ROK-1309 shipped cohort memory as a bespoke `CohortMemorySection` sitting
 * BELOW Common Ground with its own card chrome and its own endpoint. ROK-1538
 * folds it into Common Ground as a fourth themed row rendered FIRST, reusing
 * `CommonGroundThemedRow` / `CommonGroundGameCard` / `+ Nominate` / the ★
 * reason line. This spec drives the whole loop against the live API + UI:
 *
 *   1. Lineup A (admin-created, so the roster is admin-only) nominates one
 *      game G and is walked voting → decided ON G. The decide transition
 *      writes a cohort-memory row keyed on A's roster signature.
 *   2. Lineup B is created by the SAME user — identical roster, identical
 *      signature — and any auto-carried nomination is removed so B starts
 *      empty. A game already on the board is filtered out of the cohort row
 *      server-side, so this is what makes the assertion meaningful rather
 *      than accidentally green.
 *   3. On B's nominating composite the FIRST themed row must be
 *      `common-ground-themed-row-cohort`, labelled "Played with this group
 *      before", containing G with a ★ reason starting "Decided together" and
 *      an ENABLED `+ Nominate`.
 *   4. Clicking that button nominates G — the API shows it in B's entries and
 *      the cohort row drops it (it was the only remembered game, so the row
 *      goes away entirely).
 *
 * Per-worker title-prefix isolation (ROK-1147 pattern) so desktop + mobile
 * projects can run this file concurrently. No `sleep()` — every async write
 * is followed by an API poll before the UI is asserted (CLAUDE.md "Smoke
 * tests must poll API after async writes").
 *
 * Runs in both `desktop` and `mobile` projects per playwright.config.ts.
 */
import { test, expect } from './base';
import {
    apiDelete,
    apiGet,
    apiPatch,
    apiPost,
    awaitProcessing,
    cancelLineupPhaseJobs,
    createLineupOrRetry,
    getAdminToken,
    pollForCondition,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-cohort-row';
const LINEUP_DEFAULTS = {
    buildingDurationHours: 720,
    votingDurationHours: 720,
    decidedDurationHours: 720,
};

let workerPrefix: string;
let priorTitle: string;
let freshTitle: string;
let adminToken: string;
let rememberedGameId: number;
let rememberedGameName: string;
let freshLineupId: number;

interface LineupEntry {
    gameId: number;
}

/** One configured demo game to carry through the whole flow. */
async function fetchOneGame(
    token: string,
): Promise<{ id: number; name: string }> {
    const games = await apiGet(token, '/admin/settings/games');
    const first = (games?.data ?? [])[0] as
        | { id: number; name: string }
        | undefined;
    if (!first) {
        throw new Error('Demo data missing — need at least 1 configured game');
    }
    return { id: first.id, name: first.name };
}

/**
 * Lineup A: nominate G, force into voting, seed the single vote the decide
 * guard needs, then decide ON G. `writeDecidedCohortMemory` fires on that
 * transition and stamps the row the fresh lineup will read back.
 *
 * matchThreshold is deliberately LOW (10): the single seeded vote puts G at
 * 100%, well clear of the threshold, so G is NOT classified `suggested` and
 * the ROK-937 carryover helper has nothing to copy forward. Step 2 removes
 * carried entries anyway — this just keeps the common path clean.
 */
async function buildDecidedPriorLineup(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });

    const game = await fetchOneGame(token);
    rememberedGameId = game.id;
    rememberedGameName = game.name;

    const { id: priorId } = await createLineupOrRetry(
        token,
        { title: priorTitle, ...LINEUP_DEFAULTS, matchThreshold: 10 },
        workerPrefix,
    );
    await cancelLineupPhaseJobs(token, priorId);
    await apiPost(token, `/lineups/${priorId}/nominate`, {
        gameId: rememberedGameId,
    });
    await apiPost(token, '/admin/test/lineup/advance-with-zero-noms', {
        lineupId: priorId,
    });
    await apiPatch(token, `/lineups/${priorId}/status`, {
        status: 'decided',
        decidedGameId: rememberedGameId,
    });
    await awaitProcessing(token);
    await apiPatch(token, `/lineups/${priorId}/status`, { status: 'archived' });
    await awaitProcessing(token);
}

/** Lineup B — same creator, same roster, and provably zero nominations. */
async function buildFreshLineup(token: string): Promise<number> {
    const created = (await apiPost(token, '/lineups', {
        title: freshTitle,
        ...LINEUP_DEFAULTS,
    })) as { id?: number };
    if (!created?.id) {
        throw new Error(
            `Failed to create the fresh lineup: ${JSON.stringify(created).slice(0, 200)}`,
        );
    }
    await cancelLineupPhaseJobs(token, created.id);
    await awaitProcessing(token);

    // ROK-937 carryover may have pre-populated entries. The cohort row hides
    // anything already on the board, so clear them before asserting.
    const detail = await apiGet(token, `/lineups/${created.id}`);
    for (const entry of (detail?.entries ?? []) as LineupEntry[]) {
        await apiDelete(
            token,
            `/lineups/${created.id}/nominations/${entry.gameId}`,
        );
    }
    await pollForCondition(
        async () => {
            const d = await apiGet(token, `/lineups/${created.id}`);
            return ((d?.entries ?? []) as LineupEntry[]).length === 0
                ? d
                : null;
        },
        { description: 'fresh lineup drained of carried-over nominations' },
    );
    return created.id;
}

/** The cohort row must be servable BEFORE the browser is pointed at it. */
async function waitForCohortTile(token: string, lineupId: number) {
    return pollForCondition(
        async () => {
            const res = await apiGet(
                token,
                `/lineups/common-ground?minOwners=0&lineupId=${lineupId}`,
            );
            const tiles = (res?.data ?? []) as Array<{
                gameId: number;
                theme?: string;
            }>;
            return tiles.find(
                (t) => t.theme === 'cohort' && t.gameId === rememberedGameId,
            )
                ? tiles
                : null;
        },
        {
            description: `cohort tile for game ${rememberedGameId} on lineup ${lineupId}`,
            timeoutMs: 30_000,
        },
    );
}

async function gotoNominating(
    page: import('@playwright/test').Page,
): Promise<void> {
    await page.goto(`/community-lineup/${freshLineupId}`);
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 10_000,
    });
    await expect(page.getByTestId('nominating-composite-view')).toBeVisible({
        timeout: 20_000,
    });
}

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    priorTitle = `${workerPrefix}Prior Decided`;
    freshTitle = `${workerPrefix}Fresh Lineup`;
    adminToken = await getAdminToken();
    await buildDecidedPriorLineup(adminToken);
    freshLineupId = await buildFreshLineup(adminToken);
    await waitForCohortTile(adminToken, freshLineupId);
});

test.describe('Common Ground cohort row (ROK-1538)', () => {
    test('renders "Played with this group before" as the FIRST themed row', async ({
        page,
    }) => {
        await gotoNominating(page);

        const cohortRow = page.getByTestId('common-ground-themed-row-cohort');
        await expect(cohortRow).toBeVisible({ timeout: 20_000 });
        await expect(
            cohortRow.getByRole('heading', {
                name: /played with this group before/i,
            }),
        ).toBeVisible();

        // FIRST — not merely present. `common-ground-themed-row-*` matches
        // every themed row, so index 0 is the row the user sees at the top.
        const rows = page.locator('[data-testid^="common-ground-themed-row-"]');
        await expect(rows.first()).toHaveAttribute(
            'data-testid',
            'common-ground-themed-row-cohort',
        );
    });

    test('the remembered game carries the shared ★ reason and an enabled + Nominate', async ({
        page,
    }) => {
        await gotoNominating(page);

        const cohortRow = page.getByTestId('common-ground-themed-row-cohort');
        await expect(cohortRow).toBeVisible({ timeout: 20_000 });

        // The ★ line is the SAME affordance the other three rows use; the
        // API stamps it `Decided together · <MMM d>`.
        await expect(
            cohortRow.getByText(/★\s*Decided together/),
        ).toBeVisible();

        const nominate = cohortRow.getByRole('button', {
            name: new RegExp(`nominate ${escapeRe(rememberedGameName)}`, 'i'),
        });
        await expect(nominate).toBeVisible();
        await expect(nominate).toBeEnabled();
    });

    test('+ Nominate adds the remembered game and drops it from the row', async ({
        page,
    }) => {
        await gotoNominating(page);

        const cohortRow = page.getByTestId('common-ground-themed-row-cohort');
        await expect(cohortRow).toBeVisible({ timeout: 20_000 });
        await cohortRow
            .getByRole('button', {
                name: new RegExp(`nominate ${escapeRe(rememberedGameName)}`, 'i'),
            })
            .click();

        // Poll the API before trusting the UI — the nominate POST and the
        // Common Ground refetch settle out of band.
        await pollForCondition(
            async () => {
                const detail = await apiGet(
                    adminToken,
                    `/lineups/${freshLineupId}`,
                );
                return ((detail?.entries ?? []) as LineupEntry[]).some(
                    (e) => e.gameId === rememberedGameId,
                )
                    ? detail
                    : null;
            },
            {
                description: `game ${rememberedGameId} nominated onto lineup ${freshLineupId}`,
                timeoutMs: 20_000,
            },
        );

        // A nominated game is filtered out of the cohort row server-side, and
        // it was the only remembered game — so the row goes away entirely.
        await expect(
            page.getByTestId('common-ground-themed-row-cohort'),
        ).toHaveCount(0, { timeout: 20_000 });
    });
});

/** Game names come from demo data and may contain regex metacharacters. */
function escapeRe(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
