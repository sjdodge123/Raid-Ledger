/**
 * Hub polls smoke (ROK-1893 Pillar 3) — desktop, tablet AND mobile.
 *
 * Every test re-seeds through the DEMO_MODE fixture
 * `POST /admin/test/community-hubs/seed {gameId}` (see
 * `community-hubs.smoke.spec.ts`): "Seed Crew" (leader + officer + 4 members)
 * and "Seed Solo" (its leader only) are recreated with NEW ids, so a hub's
 * "Open polls" starts empty on every run. Each project seeds a DIFFERENT
 * configured game (the seed clears by game) offset from the games the other
 * hub specs use, and acts through a different crew member.
 *
 *  1. A crew member opens the hub's Events tab → New poll → the modal is
 *     locked to the hub's game and "Tagged to Seed Crew" → Create; the poll is
 *     in the hub's Open polls and NOT in the events-page banner (operator
 *     ruling 2026-10-23: a hub poll shows only on its hub until P2b).
 *  2. The poll page names its hub ("Hub: Seed Crew") and marks a member voter.
 *  3. A signed-in non-member of Seed Solo sees "Join hub" on a Solo poll,
 *     joins, the card goes away and the API reports them a member.
 *
 * Every write is confirmed by polling the API — the first render is never
 * trusted (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

interface Seed {
    gameId: number;
    hubIds: { crew: number; solo: number; archived: number };
    leaderUserId: number;
    /** `[officer, member-1, member-2, member-3, member-4]`. */
    memberUserIds: number[];
}

interface Game { id: number; name: string }

interface HubPoll { lineupId: number; matchId: number; gameName: string; hub: { id: number; name: string } | null }

interface Voter { userId: number; displayName: string; isHubMember?: boolean }

interface PollPage {
    slots: Array<{ id: number; votes: Voter[] }>;
    hub?: { id: number; name: string; viewerIsMember: boolean } | null;
}

const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };
/** community-hubs uses games `slot`, hubs-nav `3 + slot`; this spec takes `6 + slot`. */
const GAME_OFFSET = 6;

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hub-poll] missing ${label}`);
    return value;
}

function slotOf(testInfo: TestInfo): number {
    return PROJECT_SLOT[testInfo.project.name] ?? 0;
}

/** This project's crew member actor: member-1 / member-2 / member-3. */
function actorId(seed: Seed, testInfo: TestInfo): number {
    return must(seed.memberUserIds[1 + slotOf(testInfo)], 'actor member id');
}

async function projectGame(token: string, testInfo: TestInfo): Promise<Game> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const games = raw
        .map((g) => g as { id?: unknown; name?: unknown })
        .filter((g): g is Game => typeof g.id === 'number' && typeof g.name === 'string')
        .sort((a, b) => a.id - b.id);
    if (games.length === 0) throw new Error('[hub-poll] GET /games/configured returned no games');
    return must(games[(GAME_OFFSET + slotOf(testInfo)) % games.length], 'project game');
}

async function seedHubs(testInfo: TestInfo): Promise<{ seed: Seed; game: Game; admin: string }> {
    const admin = await getAdminToken();
    const game = await projectGame(admin, testInfo);
    const body = (await apiPost(admin, '/admin/test/community-hubs/seed', { gameId: game.id })) as Partial<Seed> | null;
    if (!body || !body.hubIds || !Array.isArray(body.memberUserIds) || typeof body.gameId !== 'number') {
        throw new Error(`[hub-poll] seed: ${JSON.stringify(body)}`);
    }
    return { seed: body as Seed, game, admin };
}

async function hubPolls(jwt: string, hubId: number): Promise<HubPoll[]> {
    return ((await apiGet(jwt, `/hubs/${hubId}/polls`)) ?? []) as HubPoll[];
}

async function pollPage(jwt: string, lineupId: number, matchId: number): Promise<PollPage> {
    return must((await apiGet(jwt, `/lineups/${lineupId}/schedule/${matchId}`)) as PollPage | null, 'poll page');
}

/** The viewer state the game's hub list reports for `hubId` (`member` / `not-member` / …). */
async function viewerOf(jwt: string, gameId: number, hubId: number): Promise<string | undefined> {
    const res = (await apiGet(jwt, `/hubs/by-game/${gameId}`)) as { hubs?: Array<{ id: number; viewer: string }> } | null;
    return res?.hubs?.find((h) => h.id === hubId)?.viewer;
}

/** A public poll tagged to `hubId`, created through the API (staff bypass the membership check). */
async function createHubPoll(token: string, gameId: number, hubId: number): Promise<{ lineupId: number; matchId: number }> {
    const created = (await apiPost(token, '/scheduling-polls', { gameId, hubId })) as { id?: unknown; lineupId?: unknown } | null;
    if (typeof created?.id !== 'number' || typeof created.lineupId !== 'number') {
        throw new Error(`[hub-poll] POST /scheduling-polls {hubId: ${hubId}}: ${JSON.stringify(created)}`);
    }
    return { lineupId: created.lineupId, matchId: created.id };
}

/** One proposed time 5 days out; suggesting auto-votes the suggester YES. Returns the slot id. */
async function suggestSlot(token: string, poll: { lineupId: number; matchId: number }): Promise<number> {
    const when = new Date();
    when.setDate(when.getDate() + 5);
    when.setHours(20, 0, 0, 0);
    const res = (await apiPost(token, `/lineups/${poll.lineupId}/schedule/${poll.matchId}/suggest`, {
        proposedTime: when.toISOString(),
    })) as { id?: unknown; data?: { id?: unknown } } | null;
    const id = res?.data?.id ?? res?.id;
    if (typeof id !== 'number') throw new Error(`[hub-poll] suggest: ${JSON.stringify(res)}`);
    return id;
}

function pollHref(poll: { lineupId: number; matchId: number }): string {
    return `/community-lineup/${poll.lineupId}/schedule/${poll.matchId}`;
}

async function openHubEvents(page: Page, hubId: number): Promise<void> {
    await page.goto(`/hubs/${hubId}#events`);
    await expect(page.getByTestId('hub-polls-section'), 'a community hub Events tab lists its open polls').toBeVisible({
        timeout: 20_000,
    });
}

test.describe('hub polls', () => {
    test('Events tab → New poll (hub-locked) → listed in Open polls, kept off the events banner', async ({ page }, testInfo) => {
        const { seed, game } = await seedHubs(testInfo);
        const jwt = await signInOnboardedMember(page, actorId(seed, testInfo));
        await openHubEvents(page, seed.hubIds.crew);
        await expect(page.getByTestId('hub-polls-empty'), 'a freshly seeded hub has no polls').toBeVisible({ timeout: 15_000 });

        await page.getByTestId('hub-polls-section').getByRole('button', { name: 'New poll' }).click();
        const dialog = page.getByRole('dialog', { name: 'Schedule a Game' });
        await expect(dialog).toBeVisible({ timeout: 15_000 });
        const hubLine = dialog.getByTestId('create-poll-hub-line');
        await expect(hubLine, 'the modal is tagged to the hub').toContainText('Tagged to Seed Crew');
        await expect(hubLine, 'the game is locked to the hub game').toContainText(game.name);
        await dialog.getByRole('button', { name: 'Create Poll' }).click();

        // Public poll: the modal closes and opens the poll page.
        await expect(page).toHaveURL(/\/community-lineup\/\d+\/schedule\/\d+/, { timeout: 20_000 });
        await expect.poll(async () => (await hubPolls(jwt, seed.hubIds.crew)).length, {
            message: 'the hub-tagged poll must reach GET /hubs/:id/polls',
        }).toBe(1);
        const poll = must((await hubPolls(jwt, seed.hubIds.crew))[0], 'hub poll');
        expect(poll.hub?.id, 'the listed poll is tagged to Seed Crew').toBe(seed.hubIds.crew);

        await openHubEvents(page, seed.hubIds.crew);
        const row = page.getByTestId('hub-poll-row');
        await expect(row, 'Open polls lists the new poll (exactly once)').toHaveCount(1, { timeout: 15_000 });
        await expect(row.getByRole('link', { name: game.name })).toHaveAttribute('href', pollHref(poll));

        // Ruling 2026-10-23: the banner's API list leaves hub polls out — the
        // poll is confirmed on the hub list above, so an absence here is real.
        const banner = ((await apiGet(jwt, '/scheduling-polls/active')) ?? []) as Array<{ matchId: number }>;
        expect(banner.map((p) => p.matchId), 'the site-wide polls list omits the hub poll').not.toContain(poll.matchId);
        await page.goto('/events');
        await expect(page.getByRole('heading', { level: 1 }).first(), 'the events page rendered').toBeVisible({ timeout: 20_000 });
        await expect(page.locator(`a[href="${pollHref(poll)}"]`), 'the events banner has no link to the hub poll').toHaveCount(0);
    });

    test('poll page: "Hub: Seed Crew" links the hub and a member voter carries the Member mark', async ({ page }, testInfo) => {
        const { seed, game, admin } = await seedHubs(testInfo);
        const actor = actorId(seed, testInfo);
        const poll = await createHubPoll(admin, game.id, seed.hubIds.crew);
        const slotId = await suggestSlot(admin, poll);
        const jwt = await signInOnboardedMember(page, actor);
        await apiPost(jwt, `/lineups/${poll.lineupId}/schedule/${poll.matchId}/vote`, { slotId });
        await expect.poll(async () => {
            const slot = (await pollPage(jwt, poll.lineupId, poll.matchId)).slots.find((s) => s.id === slotId);
            return slot?.votes.find((v) => v.userId === actor)?.isHubMember;
        }, { message: "the member's vote must reach the API, flagged isHubMember" }).toBe(true);
        const voter = must(
            (await pollPage(jwt, poll.lineupId, poll.matchId)).slots.find((s) => s.id === slotId)?.votes.find((v) => v.userId === actor),
            'actor voter',
        );

        await page.goto(pollHref(poll));
        const panel = page.getByTestId('scheduling-hub-panel');
        await expect(panel, 'a hub-tagged poll renders its hub block').toBeVisible({ timeout: 20_000 });
        await expect(panel.getByRole('link', { name: 'Seed Crew' })).toHaveAttribute('href', `/hubs/${seed.hubIds.crew}`);
        const chip = panel.getByTestId('scheduling-hub-voters').getByRole('listitem').filter({ hasText: voter.displayName });
        await expect(chip, 'the member voter is listed once').toHaveCount(1, { timeout: 15_000 });
        await expect(chip.getByText('Member', { exact: true }), 'the member voter carries the Member mark').toBeVisible();
        await expect(panel.getByTestId('scheduling-hub-join'), 'a member is not offered Join hub').toHaveCount(0);
    });

    test('poll page: a non-member joins the hub from the Join hub card', async ({ page }, testInfo) => {
        const { seed, game, admin } = await seedHubs(testInfo);
        const poll = await createHubPoll(admin, game.id, seed.hubIds.solo);
        // A crew member is NOT in Seed Solo (its leader only).
        const jwt = await signInOnboardedMember(page, actorId(seed, testInfo));
        expect(await viewerOf(jwt, seed.gameId, seed.hubIds.solo), 'the actor starts outside Seed Solo').toBe('not-member');

        await page.goto(pollHref(poll));
        const panel = page.getByTestId('scheduling-hub-panel');
        await expect(panel.getByRole('link', { name: 'Seed Solo' })).toBeVisible({ timeout: 20_000 });
        const card = panel.getByTestId('scheduling-hub-join');
        await expect(card, 'a signed-in non-member is offered Join hub').toBeVisible();
        await card.getByRole('button', { name: 'Join hub' }).click();

        await expect.poll(() => viewerOf(jwt, seed.gameId, seed.hubIds.solo), { message: 'Join hub must reach the API' }).toBe(
            'member',
        );
        await expect.poll(async () => (await pollPage(jwt, poll.lineupId, poll.matchId)).hub?.viewerIsMember, {
            message: 'the poll page reports the viewer a member',
        }).toBe(true);
        await expect(card, 'the Join hub card goes away once joined').toHaveCount(0, { timeout: 15_000 });
    });
});
