/**
 * ROK-1374 — the tie readiness card (AC7 / AC11 / AC13 / AC14 / AC15).
 *
 * Browser-level proof that a vote closed on a tie surfaces the comparison
 * card on the lineup page (both games, roster-scoped ownership, one Pick
 * button per game for the creator), that a pick shows who picked and the
 * lock-in countdown with Undo, that Undo restores the buttons, and that the
 * game-detail banner names the tie instead of the plain "vote now" banner.
 *
 * Fixture: a public lineup with two games at one vote each — the operator's
 * exact reported scenario — held by the DEADLINE job, which is the path a
 * real voting deadline takes (no submit ritual behind it). Serial: the three
 * tests share one lineup and the pick/undo test mutates it.
 */
import { test, expect } from './base';
import {
    API_BASE,
    apiGet,
    apiPatch,
    apiPost,
    awaitProcessing,
    createLineupOrRetry,
    getAdminToken,
    getInviteeFixture,
    pollForCondition,
    scopeBannerTo,
    getScopedBanner,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-tie-readiness';
// The default grace window (5 min) outlasts this file by far, so the pick's
// grace job never fires mid-test and no global setting is touched — a shared
// env's other workers keep whatever override they set.

interface Game {
    id: number;
    name: string;
}

let adminToken: string;
let workerPrefix: string;
let lineupId: number;
let tied: Game[] = [];

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchGames(token: string, count: number): Promise<Game[]> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`fetchGames failed: ${res.status}`);
    const body = (await res.json()) as { data: { id: number; name: string }[] };
    if ((body.data?.length ?? 0) < count) {
        throw new Error(`Need ${count} configured games, got ${body.data?.length ?? 0}`);
    }
    return body.data.slice(0, count).map((g) => ({ id: g.id, name: g.name }));
}

/** Two games, one vote each, closed by the deadline job → tie hold armed. */
async function buildDeadlineTie(): Promise<void> {
    const invitee = await getInviteeFixture();
    const [a, b, c] = await fetchGames(adminToken, 3);
    const { id } = await createLineupOrRetry(
        adminToken,
        {
            title: `${workerPrefix}-Tie Readiness`,
            description: 'ROK-1374 readiness card smoke',
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );
    lineupId = id;
    await apiPost(adminToken, `/lineups/${id}/nominate`, { gameId: a.id });
    await apiPost(adminToken, `/lineups/${id}/nominate`, { gameId: b.id });
    await apiPost(adminToken, '/admin/test/nominate-game', {
        lineupId: id,
        gameId: c.id,
        userId: invitee.userId,
    });
    await apiPatch(adminToken, `/lineups/${id}/status`, { status: 'voting' });
    await apiPost(adminToken, `/lineups/${id}/vote`, { gameId: a.id });
    await apiPost(adminToken, '/admin/test/cast-vote', {
        lineupId: id,
        gameId: b.id,
        userId: invitee.userId,
    });
    await apiPost(adminToken, '/admin/test/lineup/fire-deadline-transition', {
        lineupId: id,
        targetStatus: 'decided',
    });
    await awaitProcessing(adminToken);
    tied = [a, b];
    await pollForCondition(
        async () => {
            const r = (await apiGet(adminToken, `/lineups/${id}/tie-readiness`)) as
                | { status?: string }
                | null;
            return r?.status === 'awaiting_pick' ? r : null;
        },
        { timeoutMs: 15_000, description: 'tie hold armed on the fixture lineup' },
    );
}

test.beforeAll(async ({}, testInfo) => {
    adminToken = await getAdminToken();
    workerPrefix = `${FILE_PREFIX}-w${testInfo.workerIndex}`;
    await buildDeadlineTie();
});

test.afterAll(async () => {
    if (!adminToken) return;
    await apiPost(adminToken, '/admin/test/reset-lineups', { titlePrefix: workerPrefix }).catch(
        () => null,
    );
});

test.describe('Tie readiness card (ROK-1374)', () => {
    test('a vote closed on a tie shows the card: both games, roster ownership, one Pick per game', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        const card = page.getByRole('region', { name: 'Tie readiness' });
        await expect(card).toBeVisible({ timeout: 15_000 });
        await expect(card.getByRole('heading', { name: /^Tied — \d+ votes? each$/ })).toBeVisible();
        for (const game of tied) {
            await expect(card.getByText(game.name).first()).toBeVisible();
            // The admin created the lineup, so it may pick (AC15).
            await expect(
                card.getByRole('button', {
                    name: `Pick ${game.name}`,
                    exact: true,
                }),
            ).toBeVisible();
        }
        // Ownership is roster-scoped: "N of M on the roster own it" (AC11).
        await expect(card.getByText(/\d+ of \d+ on the roster own it/).first()).toBeVisible();

        // The card names every roster member's wait, not just the viewer's
        // (operator ruling 2026-09-05). Nobody in this fixture has opted into
        // sharing — it is a separate consent, default OFF — so the other
        // member's line reads exactly "<name> · not shared", and the admin
        // (the viewer, who has no stored speed here) gets the invitation that
        // occupies their own slot.
        await expect(card.getByText(/ · not shared$/).first()).toBeVisible();
        await expect(
            card.getByRole('button', { name: 'Add your connection speed' }).first(),
        ).toBeVisible();
    });

    test('a pick names the picker with the lock-in countdown and Undo; Undo restores the Pick buttons (AC14)', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        const card = page.getByRole('region', { name: 'Tie readiness' });
        await expect(card).toBeVisible({ timeout: 15_000 });

        await card.getByRole('button', { name: `Pick ${tied[0].name}`, exact: true }).click();
        await expect(
            card.getByText(new RegExp(`picked ${escapeRe(tied[0].name)} · locks in \\d+s`)),
        ).toBeVisible({ timeout: 10_000 });
        await expect(card.getByRole('button', { name: `Pick ${tied[1].name}`, exact: true })).toHaveCount(0);

        await card.getByRole('button', { name: 'Undo' }).click();
        await expect(card.getByRole('button', { name: `Pick ${tied[0].name}`, exact: true })).toBeVisible({
            timeout: 10_000,
        });
        await expect(card.getByRole('button', { name: `Pick ${tied[1].name}`, exact: true })).toBeVisible();
    });

    test('the game-detail banner names the tie instead of the plain vote banner (AC13)', async ({ page }) => {
        // The game-detail `LineupVoteBanner` renders from `GET /lineups/banner`,
        // a GLOBAL singleton (the newest eligible lineup on the instance). On
        // the fleet ONE env serves the desktop AND mobile projects plus every
        // other lane, so a sibling's newer lineup would own it. Scope the page
        // to OUR lineup instead: under DEMO_MODE the web passes `?lineupId=`
        // from the `scopeBannerTo` session key, so siblings cannot take it.
        //
        // The scoped API read is the precondition: if our lineup is no longer
        // banner-eligible (an earlier test or a phase job moved it on), build a
        // fresh tie first, then fail by name if the scoped banner still is not
        // ours. Only UI eventual consistency is retried below.
        test.setTimeout(120_000);
        const scoped = await getScopedBanner(adminToken, lineupId);
        if (scoped?.id !== lineupId) {
            await buildDeadlineTie();
        }
        await scopeBannerTo(page, lineupId);
        expect(
            (await getScopedBanner(adminToken, lineupId))?.id,
            `GET /lineups/banner?lineupId=${lineupId} resolves to the tie fixture`,
        ).toBe(lineupId);

        await expect(async () => {
            await page.goto(`/games/${tied[0].id}`);
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
                timeout: 10_000,
            });
            await expect(page.getByText(/Tied — waiting on .+ to pick/)).toBeVisible({
                timeout: 10_000,
            });
        }).toPass({ timeout: 60_000, intervals: [1_000] });

        await expect(page.getByText(/Compare them/)).toBeVisible();
    });
});
