/**
 * Poll / lineup Discussion card smoke (ROK-2272 S9) — desktop AND mobile.
 *
 * Poll cases use the real api: the caller's tagged community-hubs fixture on a
 * configured game (`seedCommunityHubs … { gameId }`), then the admin creates a
 * standalone poll tagged to the crew hub (`POST /scheduling-polls` `hubId`).
 * Crew member-1 suggests a time (suggesting auto-votes YES) — the voter;
 * crew member-2 never votes — the reader (R7). The S7 sync creates the thread
 * on the lifecycle emit, so every case polls the summary until it is `ready`
 * before trusting the page.
 *
 *  1. Voter: the card shows, the inline reply posts and appears on the card.
 *  2. Non-voter: the poll reader note and no composer.
 *  3. Private poll: the discussion routes 404 (`requireHubPoll` — a private
 *     poll never gets a thread), and an invited member sees the poll page
 *     render with no card.
 *  4. Lineup: `page.route` stubs `GET /lineups/:id/discussion` ONLY — no
 *     api/fixture path tags a non-standalone lineup to a hub — and the lineup
 *     page renders the card from it.
 *
 * The locked-in poll case is covered by Vitest + the fleet test plan.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiGet, apiPost, getAdminToken } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';
import { editorTextbox } from './hub-post-editor';
import { getFirstGameId } from './scheduling-poll-fixtures';

const SLUG = 'poll-discussion';
const READER_NOTE = 'Vote in the poll to join the discussion.';

interface PollSeed {
    lineupId: number;
    pollId: number;
    voterUserId: number;
    readerUserId: number;
}

interface Summary {
    state: string;
    latestReplies?: Array<{ body: string }>;
}

/** Fail loudly on a missing value (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[poll-discussion] missing ${label}`);
    return value;
}

function futureIso(daysOut: number): string {
    const when = new Date();
    when.setDate(when.getDate() + daysOut);
    when.setHours(20, 0, 0, 0);
    return when.toISOString();
}

async function summary(jwt: string, pollId: number): Promise<Summary | null> {
    return (await apiGet(jwt, `/scheduling-polls/${pollId}/discussion`)) as Summary | null;
}

/** Seed the crew hub and a hub-tagged standalone poll (`visibility`); a private poll invites the reader. */
async function seedPoll(testInfo: TestInfo, visibility: 'public' | 'private'): Promise<PollSeed & { admin: string; crew: number }> {
    const admin = await getAdminToken();
    const gameId = await getFirstGameId(admin);
    const hubs = (await seedCommunityHubs(admin, testInfo, SLUG, { gameId })) as
        { hubIds?: { crew?: number }; memberUserIds?: number[] } | null;
    const crew = must(hubs?.hubIds?.crew, `crew hub in ${JSON.stringify(hubs)}`);
    const voterUserId = must(hubs?.memberUserIds?.[1], 'crew member-1');
    const readerUserId = must(hubs?.memberUserIds?.[2], 'crew member-2');
    const invite = visibility === 'private' ? { memberUserIds: [readerUserId] } : {};
    const poll = (await apiPost(admin, '/scheduling-polls', { gameId, hubId: crew, visibility, ...invite })) as
        { id?: number; lineupId?: number } | null;
    return {
        admin,
        crew,
        pollId: must(poll?.id, `poll id in ${JSON.stringify(poll)}`),
        lineupId: must(poll?.lineupId, 'poll lineupId'),
        voterUserId,
        readerUserId,
    };
}

/** Wait until the poll's thread summary is `ready` for `jwt` (the S7 sync is async). */
async function waitReady(jwt: string, seed: PollSeed): Promise<void> {
    await expect
        .poll(async () => (await summary(jwt, seed.pollId))?.state, {
            message: 'the S7 sync created the poll thread',
            timeout: 20_000,
        })
        .toBe('ready');
}

/** The raw HTTP status of the poll discussion summary for `jwt`. */
async function summaryStatus(jwt: string, pollId: number): Promise<number> {
    const res = await fetch(`${API_BASE}/scheduling-polls/${pollId}/discussion`, {
        headers: { Authorization: `Bearer ${jwt}` },
    });
    return res.status;
}

async function openPollCard(page: Page, seed: PollSeed): Promise<Locator> {
    await page.goto(`/community-lineup/${seed.lineupId}/schedule/${seed.pollId}`);
    const card = page.getByTestId('poll-discussion-card');
    await expect(card, 'the poll page shows the Discussion card').toBeVisible({ timeout: 20_000 });
    return card;
}

test.describe('poll discussion card', () => {
    test('a voter replies inline and the reply shows on the card', async ({ page }, testInfo) => {
        const seed = await seedPoll(testInfo, 'public');
        const voterJwt = await signInOnboardedMember(page, seed.voterUserId);
        await apiPost(voterJwt, `/lineups/${seed.lineupId}/schedule/${seed.pollId}/suggest`, { proposedTime: futureIso(5) });
        await waitReady(voterJwt, seed);
        const card = await openPollCard(page, seed);
        const text = `Poll discussion smoke ${testInfo.project.name} ${Date.now()}`;
        const box = await editorTextbox(page, card.getByTestId('forum-reply-input'));
        await box.click();
        await page.keyboard.type(text);
        await expect(box, 'the reply editor holds the typed text').toContainText(text);
        await card.getByTestId('forum-reply-submit').click();
        await expect
            .poll(async () => (await summary(voterJwt, seed.pollId))?.latestReplies?.map((r) => r.body) ?? [], {
                message: 'the API stored the reply',
                timeout: 15_000,
            })
            .toContain(text);
        await expect(card.getByTestId('poll-discussion-reply').filter({ hasText: text }), 'the reply shows on the card').toBeVisible();
    });

    test('a hub member who has not voted reads with the reader note and no composer (R7)', async ({ page }, testInfo) => {
        const seed = await seedPoll(testInfo, 'public');
        await waitReady(await signInOnboardedMember(page, seed.readerUserId), seed);
        const card = await openPollCard(page, seed);
        await expect(card.getByTestId('poll-discussion-signup-note'), 'the reader note').toContainText(READER_NOTE);
        await expect(card.getByTestId('forum-reply-composer'), 'no composer for a non-voter').toHaveCount(0);
    });

    test('a private poll has no Discussion card, even for an invited member', async ({ page }, testInfo) => {
        const seed = await seedPoll(testInfo, 'private');
        const inviteeJwt = await signInOnboardedMember(page, seed.readerUserId);
        // requireHubPoll: a private poll 404s the discussion route for everyone (creator and invitee).
        expect(await summaryStatus(seed.admin, seed.pollId), 'the creator gets a 404 discussion').toBe(404);
        expect(await summaryStatus(inviteeJwt, seed.pollId), 'the invitee gets a 404 discussion').toBe(404);
        const fetched = page.waitForResponse((r) =>
            new URL(r.url()).pathname.endsWith(`/scheduling-polls/${seed.pollId}/discussion`),
        );
        await page.goto(`/community-lineup/${seed.lineupId}/schedule/${seed.pollId}`);
        // The invitee can see the poll itself, so the card would have mounted here.
        await expect(page.getByTestId('scheduling-composite'), 'the invitee sees the private poll').toBeVisible({ timeout: 20_000 });
        expect((await fetched).status(), 'the page asked for the discussion and got a 404').toBe(404);
        await expect(page.getByTestId('poll-discussion-card'), 'no card on a private poll').toHaveCount(0);
    });
});

test.describe('lineup discussion card', () => {
    test('the lineup page renders the card from the lineup discussion route (stubbed)', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const prefix = `smoke-${SLUG}-${testInfo.project.name}-w${testInfo.parallelIndex}-`;
        await apiPost(admin, '/admin/test/reset-lineups', { titlePrefix: prefix });
        const created = (await apiPost(admin, '/lineups', {
            title: `${prefix}Lineup discussion`,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        })) as { id?: number } | null;
        const lineupId = must(created?.id, `lineup id in ${JSON.stringify(created)}`);
        await page.route(`**/lineups/${lineupId}/discussion`, (route) =>
            route.fulfill({
                json: {
                    state: 'ready', kind: 'lineup', guildId: 1, threadId: 1, replyCount: 0,
                    latestReplies: [], lock: null, can: { read: true, reply: false },
                },
            }),
        );
        const hubs = (await seedCommunityHubs(admin, testInfo, SLUG, { gameId: await getFirstGameId(admin) })) as
            { memberUserIds?: number[] } | null;
        await signInOnboardedMember(page, must(hubs?.memberUserIds?.[1], 'crew member-1'));
        await page.goto(`/community-lineup/${lineupId}`);
        const card = page.getByTestId('lineup-discussion-card');
        await expect(card, 'the lineup page shows the Discussion card').toBeVisible({ timeout: 20_000 });
        await expect(card.getByTestId('lineup-discussion-signup-note')).toContainText('Nominate or vote to join the discussion.');
    });
});
