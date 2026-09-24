/**
 * Scheduling poll live updates + lock-in deep link smoke (ROK-1551, ROK-1604).
 * Route: /community-lineup/:lineupId/schedule/:matchId
 *
 * - S2-AC1: with the poll open in browser B, a vote cast (or retracted) by
 *   user A shows in B within 10 s — no reload, no user action in B.
 * - S3-AC2: `?lock=<slotId>` opens the EXISTING lock-in confirm for the
 *   creator/operator and never commits; a plain member gets the
 *   "You can't lock in this poll" toast. The param is stripped after one read.
 * - S2-AC4 copy: at/above the threshold the confirm reads
 *   "Lock in <time> for everyone?".
 *
 * Each test owns a fresh PUBLIC standalone poll (desktop + mobile workers run
 * this file concurrently, so nothing is shared). Context A is the admin
 * (`page`, global storageState); context B is a second browser context signed
 * in as the member fixture via `localStorage.raid_ledger_token`.
 */
import { test, expect } from './base';
import type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import { STORAGE_STATE_PATH } from '../auth-paths';
import { dismissGameTimeCheck, isTablet } from './helpers';
import {
    API_BASE,
    apiDelete,
    apiGet,
    apiPatch,
    apiPost,
    getAdminToken,
    getInviteeFixture,
    pollForCondition,
} from './api-helpers';

/** ROK-1551 S2-AC1 bound: socket ~2–3 s, fallback interval ≤10 s. */
const LIVE_BOUND_MS = 10_000;

interface PollFixture {
    lineupId: number;
    matchId: number;
    /** The slot the cases read in the LADDER — deliberately never the leader. */
    slotId: number;
    /**
     * ROK-1635 AC1: the leading time renders on the card and its ladder row is
     * removed. This decoy holds the lead so {@link PollFixture.slotId} keeps a
     * row to assert on — see {@link createPollWithSlot}.
     */
    leaderSlotId: number;
}

interface PollApiResponse {
    pollStatus?: string;
    match?: { status?: string; members?: unknown[] };
    slots?: { id: number; votes?: { userId: number }[] }[];
}

/** Resolve a configured game id from seed data. */
async function firstGameId(token: string): Promise<number> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`games/configured failed: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games');
    return body.data[0].id;
}

/** Poll the poll-page API until the slot shows exactly `votes` voters. */
async function waitForSlotVotes(
    token: string,
    fx: PollFixture,
    votes: number,
): Promise<PollApiResponse> {
    return pollForCondition<PollApiResponse>(
        async () => {
            const data = (await apiGet(
                token,
                `/lineups/${fx.lineupId}/schedule/${fx.matchId}`,
            )) as PollApiResponse | null;
            const slot = data?.slots?.find((s) => s.id === fx.slotId);
            return slot && (slot.votes?.length ?? 0) === votes ? data : null;
        },
        { timeoutMs: 15_000, description: `slot ${fx.slotId} has ${votes} vote(s)` },
    );
}

/** Suggest one future time, `daysOut` days from now at 20:00 local. */
async function suggestAt(
    token: string,
    poll: { id: number; lineupId: number },
    daysOut: number,
): Promise<number> {
    const when = new Date();
    when.setDate(when.getDate() + daysOut);
    when.setHours(20, 0, 0, 0);
    const res = await apiPost(
        token,
        `/lineups/${poll.lineupId}/schedule/${poll.id}/suggest`,
        { proposedTime: when.toISOString() },
    );
    const slotId: number | undefined = res?.data?.id ?? res?.id;
    if (!slotId) throw new Error('suggest did not return a slot id');
    return slotId;
}

/**
 * Create a public standalone poll with TWO future slots. Suggesting auto-votes
 * for the suggester, so both start at 1 vote (the admin's) and the EARLIER one
 * wins the net-score tie — permanently, since no case below touches it.
 *
 * ROK-1635 AC1 is why there are two: the leading time is rendered on the card
 * and its ladder row is removed, and a one-slot poll leads in every stance
 * (an unanswered poll keeps a provisional leader), so the single slot this
 * fixture used to create had no row for `slotParts` to read. The returned
 * `slotId` is the LATER slot — the one that stays in the ladder at 0 or 1
 * vote either way, because the decoy is level with it and earlier.
 */
async function createPollWithSlot(token: string): Promise<PollFixture> {
    const gameId = await firstGameId(token);
    const poll = (await apiPost(token, '/scheduling-polls', { gameId })) as {
        id?: number;
        lineupId?: number;
    };
    if (!poll?.id || !poll.lineupId) throw new Error('standalone poll create failed');
    const created = { id: poll.id, lineupId: poll.lineupId };
    const leaderSlotId = await suggestAt(token, created, 3);
    const slotId = await suggestAt(token, created, 4);
    const fx = { lineupId: poll.lineupId, matchId: poll.id, slotId, leaderSlotId };
    await waitForSlotVotes(token, fx, 1);
    await waitForSlotVotes(token, { ...fx, slotId: leaderSlotId }, 1);
    return fx;
}

/** Toggle `token`'s vote on the fixture slot via the API. */
async function toggleVoteApi(token: string, fx: PollFixture): Promise<void> {
    await apiPost(token, `/lineups/${fx.lineupId}/schedule/${fx.matchId}/vote`, {
        slotId: fx.slotId,
    });
}

/** Poll page URL, optionally with the `?lock=` deep link. */
function pollUrl(fx: PollFixture, lock?: number): string {
    const base = `/community-lineup/${fx.lineupId}/schedule/${fx.matchId}`;
    return lock === undefined ? base : `${base}?lock=${lock}`;
}

/** Open the poll page and wait for the composite (dismissing the game-time check). */
async function openPoll(page: Page, url: string): Promise<void> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('scheduling-composite')).toBeVisible({
        timeout: 20_000,
    });
    await dismissGameTimeCheck(page);
}

/** The slot's row and its "N vote(s)" summary text. */
function slotParts(page: Page, slotId: number): { row: Locator; count: Locator } {
    const row = page.locator(`[data-testid="schedule-slot"][data-slot-id="${slotId}"]`);
    return { row, count: row.getByText(/^\d+ votes?$/) };
}

/**
 * Second browser context signed in as the member fixture, on the same device
 * profile as the running project (viewport / touch / UA).
 */
async function openMemberContext(
    browser: Browser,
    info: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
    const { viewport, userAgent, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
    const context = await browser.newContext({
        storageState: STORAGE_STATE_PATH,
        viewport,
        userAgent,
        isMobile,
        hasTouch,
        deviceScaleFactor,
    });
    const invitee = await getInviteeFixture();
    await context.addInitScript((t) => {
        localStorage.setItem('raid_ledger_token', t);
    }, invitee.jwt);
    return { context, page: await context.newPage() };
}

test.describe.configure({ timeout: 120_000 });

test.beforeEach(() => {
    test.skip(
        isTablet(test.info()),
        'Desktop + mobile per ROK-1551 lane G; the tablet phone layout is covered by mobile',
    );
});

test.describe('Scheduling poll live votes (ROK-1551 S2-AC1)', () => {
    test('a vote cast in context A appears in context B without reload', async ({
        page,
        browser,
    }) => {
        const token = await getAdminToken();
        const fx = await createPollWithSlot(token);
        // Clear the suggester's auto-vote so A's tap is the only thing that
        // can move B's count off zero.
        await toggleVoteApi(token, fx);
        await waitForSlotVotes(token, fx, 0);
        const member = await openMemberContext(browser, test.info());
        try {
            await openPoll(member.page, pollUrl(fx));
            const b = slotParts(member.page, fx.slotId);
            await expect(b.count).toHaveText('0 votes', { timeout: 15_000 });

            await openPoll(page, pollUrl(fx));
            const a = slotParts(page, fx.slotId);
            await a.row.getByRole('button', { name: /^vote for/i }).click();

            // B took no action and did not reload.
            await expect(b.count).toHaveText('1 vote', { timeout: LIVE_BOUND_MS });
            await expect(a.row).toHaveAttribute('data-voted', 'true');
        } finally {
            await member.context.close();
            await apiDelete(token, `/lineups/${fx.lineupId}`).catch(() => {});
        }
    });

    test('a vote retracted via the API disappears from context B without reload', async ({
        browser,
    }) => {
        const token = await getAdminToken();
        const fx = await createPollWithSlot(token);
        const member = await openMemberContext(browser, test.info());
        try {
            await openPoll(member.page, pollUrl(fx));
            const b = slotParts(member.page, fx.slotId);
            await expect(b.count).toHaveText('1 vote', { timeout: 15_000 });

            await toggleVoteApi(token, fx);

            await expect(b.count).toHaveText('0 votes', { timeout: LIVE_BOUND_MS });
        } finally {
            await member.context.close();
            await apiDelete(token, `/lineups/${fx.lineupId}`).catch(() => {});
        }
    });
});

test.describe('Scheduling poll ?lock= deep link (ROK-1604 S3-AC2)', () => {
    // ROK-1683: on phones a stale admin game time opens the "Game time check"
    // sheet on mount, and it stacks with the ?lock= confirm so neither can be
    // dismissed. Full gates only passed because earlier specs happened to
    // confirm the admin's game time first (reset-to-seed keeps the admin).
    // Same guard as scheduling-leader-floor.smoke.spec.ts (ROK-1617).
    test.beforeAll(async () => {
        const token = await getAdminToken();
        await apiPatch(token, '/users/me/game-time/confirm', {});
    });

    test('creator/operator: opens the neutral lock-in confirm and never locks directly', async ({
        page,
    }) => {
        const token = await getAdminToken();
        const fx = await createPollWithSlot(token);
        try {
            // Member votes too (public lineup ⇒ self-enrol): 2 of 2 voters
            // meets computeRequiredVoters(2) = 2, so the confirm is the
            // neutral variant — reachable only through the deep link.
            await toggleVoteApi((await getInviteeFixture()).jwt, fx);
            await waitForSlotVotes(token, fx, 2);

            await openPoll(page, pollUrl(fx, fx.slotId));
            const confirm = page
                .getByRole('dialog')
                .filter({ hasText: /for everyone\?/ });
            await expect(
                confirm.getByRole('heading', { name: /^Lock in .+ for everyone\?$/ }),
            ).toBeVisible({ timeout: 15_000 });
            await expect(confirm.getByRole('button', { name: 'Lock in' })).toBeVisible();

            // Opened, not committed: still on the poll, param stripped, poll open.
            await expect(page).toHaveURL((u) => !u.searchParams.has('lock'));
            expect(new URL(page.url()).pathname).toBe(pollUrl(fx));
            await confirm.getByRole('button', { name: 'Cancel' }).click();
            await expect(confirm).toHaveCount(0);
            const after = await waitForSlotVotes(token, fx, 2);
            expect(after.pollStatus).toBe('open');

            // A refresh never re-opens it.
            await openPoll(page, page.url());
            await expect(page.getByRole('dialog').filter({ hasText: /for everyone\?/ })).toHaveCount(0);
        } finally {
            await apiDelete(token, `/lineups/${fx.lineupId}`).catch(() => {});
        }
    });

    test("plain member: gets the can't-lock toast and no confirm", async ({ browser }) => {
        const token = await getAdminToken();
        const fx = await createPollWithSlot(token);
        const member = await openMemberContext(browser, test.info());
        try {
            await openPoll(member.page, pollUrl(fx, fx.slotId));
            await expect(member.page.getByText("You can't lock in this poll")).toBeVisible({
                timeout: 15_000,
            });
            await expect(member.page.getByRole('heading', { name: /^Lock in / })).toHaveCount(0);
            await expect(member.page).toHaveURL((u) => !u.searchParams.has('lock'));
            const after = await waitForSlotVotes(token, fx, 1);
            expect(after.pollStatus).toBe('open');
        } finally {
            await member.context.close();
            await apiDelete(token, `/lineups/${fx.lineupId}`).catch(() => {});
        }
    });
});
