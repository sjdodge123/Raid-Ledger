/**
 * Hub invite links + auto-membership smoke (ROK-1893 P1) — every project.
 *
 * Every test re-seeds through the DEMO_MODE fixture
 * `POST /admin/test/community-hubs/seed {gameId}` on a configured game no other
 * hub spec seeds (index 6 + project slot; community-hubs takes 0–2, hubs-nav
 * 3–5), so the parallel projects never clear each other's hubs.
 *
 * Actors (all A2-eligible — the seed gives them a synthetic Discord snowflake
 * and `guild_member_seen_at`, which is all `isInDiscordGuild` reads, so no bot
 * is needed on CI):
 *  - the inviter: this project's "Seed Crew" member (member-1 / -2 / -3);
 *  - the outsider: `demo-member` (the seed's proposer, never in "Seed Crew");
 *  - the Leader: `community-leader`, for the auto-membership switch.
 *
 * The signup itself goes through the member's own `POST /events/:id/signup`
 * (the real route, which emits `SIGNUP_EVENTS.CREATED`); the prompt is then
 * asserted on the event page. Every write is confirmed by polling the API.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import type { TestWorld } from './test-world';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

interface Seed {
    gameId: number;
    hubIds: { crew: number; solo: number; archived: number };
    leaderUserId: number;
    /** `[officer, member-1, member-2, member-3, member-4]`. */
    memberUserIds: number[];
    proposalId: number;
}

interface InviteRow { id: number; token: string | null; url: string | null; revokedAt: string | null }
interface PromptRow { id: number; kind: string; hubId: number; source: string; sourceRef: number | null }

const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };
/** Past community-hubs (0–2) and hubs-nav (3–5) so no other spec reseeds this game. */
const GAME_INDEX_BASE = 6;
const HUB = 'Seed Crew';

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hub-invite] missing ${label}`);
    return value;
}

function slotOf(testInfo: TestInfo): number {
    return PROJECT_SLOT[testInfo.project.name] ?? 0;
}

async function projectGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[hub-invite] GET /games/configured returned no games');
    return must(ids[(GAME_INDEX_BASE + slotOf(testInfo)) % ids.length], 'project game id');
}

async function seedHubs(testInfo: TestInfo): Promise<Seed> {
    const token = await getAdminToken();
    const gameId = await projectGameId(token, testInfo);
    const body = (await apiPost(token, '/admin/test/community-hubs/seed', { gameId })) as Partial<Seed> | null;
    if (!body || typeof body.proposalId !== 'number' || !body.hubIds || !Array.isArray(body.memberUserIds)) {
        throw new Error(`[hub-invite] seed: ${JSON.stringify(body)}`);
    }
    return body as Seed;
}

/** This project's crew member: member-1 / member-2 / member-3. */
function inviterId(seed: Seed, testInfo: TestInfo): number {
    return must(seed.memberUserIds[1 + slotOf(testInfo)], 'inviter member id');
}

/** `demo-member` — the seeded proposal's proposer, never in "Seed Crew". */
async function outsiderId(seed: Seed): Promise<number> {
    const queue = (await apiGet(await getAdminToken(), '/admin/hubs/proposals')) as {
        items?: Array<{ id: number; proposedBy: { userId: number } }>;
    } | null;
    return must(queue?.items?.find((p) => p.id === seed.proposalId), 'the seeded proposal').proposedBy.userId;
}

async function viewerOf(jwt: string, gameId: number, hubId: number): Promise<string | undefined> {
    const body = (await apiGet(jwt, `/hubs/by-game/${gameId}`)) as { hubs?: Array<{ id: number; viewer: string }> } | null;
    return body?.hubs?.find((h) => h.id === hubId)?.viewer;
}

async function invites(jwt: string, hubId: number): Promise<InviteRow[]> {
    return ((await apiGet(jwt, `/hubs/${hubId}/invites`)) as { items?: InviteRow[] } | null)?.items ?? [];
}

async function previewState(token: string): Promise<string | undefined> {
    return ((await apiGet(await getAdminToken(), `/hubs/invites/${token}`)) as { state?: string } | null)?.state;
}

async function autoMode(hubId: number): Promise<string | undefined> {
    const page = (await apiGet(await getAdminToken(), `/guilds/${hubId}`)) as { guild?: { autoMembership?: string } } | null;
    return page?.guild?.autoMembership;
}

async function eventPrompts(jwt: string, eventId: number): Promise<PromptRow[]> {
    const body = (await apiGet(jwt, '/users/me/hub-join-prompts')) as { items?: PromptRow[] } | null;
    return (body?.items ?? []).filter((p) => p.source === 'signup' && p.sourceRef === eventId);
}

/** Open the Members tab's "Invite people" dialog (Modal ≥1024px, BottomSheet below — both named dialogs). */
async function openInviteDialog(page: Page, hubId: number): Promise<Locator> {
    await page.goto(`/hubs/${hubId}#members`);
    await page.getByTestId('hub-invite-open').click({ timeout: 20_000 });
    const dialog = page.getByRole('dialog', { name: `Invite people to ${HUB}` });
    await expect(dialog).toBeVisible();
    return dialog;
}

/** Create a link in the dialog; returns the API row once it is there. */
async function createLink(page: Page, jwt: string, hubId: number): Promise<{ invite: InviteRow; token: string }> {
    const dialog = await openInviteDialog(page, hubId);
    await dialog.getByTestId('hub-invite-create').click();
    await expect.poll(async () => (await invites(jwt, hubId)).length, { message: 'the new link must reach the API' }).toBe(1);
    const invite = must((await invites(jwt, hubId))[0], 'the created invite');
    const token = must(invite.token, 'the maker sees the token');
    const url = dialog.getByTestId('hub-invite-url');
    await expect(url, 'the newest link is shown with its URL').toHaveValue(new RegExp(`/h/${token}$`), { timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: 'Copy to clipboard' }), 'the link has a copy action').toBeVisible();
    await expect(dialog.getByTestId('hub-invite-row'), '"Your links" lists it').toHaveCount(1);
    return { invite, token };
}

/** The Leader sets the hub's auto-membership mode in the settings sheet. */
async function setModeAsLeader(page: Page, seed: Seed, label: 'Off' | 'Suggest' | 'Auto'): Promise<void> {
    await page.goto(`/hubs/${seed.hubIds.crew}`);
    await page.getByTestId('guild-settings-trigger').click({ timeout: 20_000 });
    const section = page.getByTestId('guild-settings-sheet').getByTestId('community-settings-auto-membership');
    await section.getByRole('radio', { name: label, exact: true }).check();
    await expect.poll(() => autoMode(seed.hubIds.crew), { message: `mode ${label} must reach the API` }).toBe(label.toLowerCase());
}

/** Events createHubEvent made; deleted after each test (the admin is auto-signed-up to them). */
const createdHubEvents: number[] = [];

/**
 * A future event on the seed game tagged to "Seed Crew"; its id is claimed before any assertion.
 * Pinned to 04:00 UTC, an hour no scheduling fixture uses: at "now + 3d" it covered the admin's
 * templated evening hour, and a leaked copy made the scheduling-poll heatmap read that hour busy.
 */
async function createHubEvent(world: TestWorld, seed: Seed): Promise<number> {
    const start = new Date(Date.now() + 3 * 24 * 3600_000);
    start.setUTCHours(4, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600_000);
    const event = (await apiPost(await world.token(), '/events', {
        title: world.uid('hub-event'),
        gameId: seed.gameId,
        guildId: seed.hubIds.crew,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        maxAttendees: 10,
    })) as { id?: number } | null;
    const id = must(event?.id, `POST /events (tagged) → ${JSON.stringify(event)}`);
    createdHubEvents.push(id);
    return id;
}

/** The outsider signs up through the real route, then waits for the post-commit prompt. */
async function signUpOutsider(page: Page, seed: Seed, eventId: number, kind: string): Promise<string> {
    const jwt = await signInOnboardedMember(page, await outsiderId(seed));
    await apiPost(jwt, `/events/${eventId}/signup`, {});
    await expect.poll(async () => (await eventPrompts(jwt, eventId)).map((p) => `${p.kind}:${p.hubId}`), {
        message: `the signup must raise a ${kind} prompt for hub ${seed.hubIds.crew}`,
        timeout: 30_000,
    }).toEqual([`${kind}:${seed.hubIds.crew}`]);
    return jwt;
}

test.describe('hub invite links', () => {
    test('a member creates a link; an outsider in the Discord server joins through /h/<token>', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const inviterJwt = await signInOnboardedMember(page, inviterId(seed, testInfo));
        const { token } = await createLink(page, inviterJwt, seed.hubIds.crew);

        const joinerJwt = await signInOnboardedMember(page, await outsiderId(seed));
        expect(await viewerOf(joinerJwt, seed.gameId, seed.hubIds.crew), 'the outsider starts outside the hub').toBe('not-member');
        await page.goto(`/h/${token}`);
        await expect(page.getByRole('heading', { name: HUB })).toBeVisible({ timeout: 20_000 });
        await page.getByTestId('hub-invite-join').click();
        await expect(page).toHaveURL(new RegExp(`/hubs/${seed.hubIds.crew}(?:[?#]|$)`), { timeout: 15_000 });
        await expect.poll(() => viewerOf(joinerJwt, seed.gameId, seed.hubIds.crew), {
            message: 'the invite Join must reach the API',
        }).toBe('member');
        await expect.poll(async () => (await invites(inviterJwt, seed.hubIds.crew))[0]?.revokedAt ?? 'live', {
            message: 'the link stays live after one use',
        }).toBe('live');
    });

    test('a revoked link shows the revoked state on the landing page', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const jwt = await signInOnboardedMember(page, inviterId(seed, testInfo));
        const { token } = await createLink(page, jwt, seed.hubIds.crew);
        expect(await previewState(token), 'the link is live before Revoke').toBe('ok');

        await page.getByRole('dialog', { name: `Invite people to ${HUB}` }).getByTestId('hub-invite-revoke').click();
        await expect.poll(() => previewState(token), { message: 'the revoke must reach the API' }).toBe('revoked');

        await page.goto(`/h/${token}`);
        await expect(page.getByRole('alert').filter({ hasText: 'This invite link was revoked' })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('hub-invite-join'), 'a revoked link offers no Join').toHaveCount(0);
    });
});

test.describe('hub auto-membership', () => {
    test.afterEach(async () => {
        const token = await getAdminToken();
        for (const id of createdHubEvents.splice(0)) await apiDelete(token, `/events/${id}`);
    });

    test('suggest: the signer sees "Join Seed Crew?" on the event page; Not now hides it', async ({ page, world }, testInfo) => {
        const seed = await seedHubs(testInfo);
        await signInOnboardedMember(page, seed.leaderUserId);
        // New hubs start on Suggest, so go through Off to prove the control writes both ways.
        await setModeAsLeader(page, seed, 'Off');
        await setModeAsLeader(page, seed, 'Suggest');
        const eventId = await createHubEvent(world, seed);

        const jwt = await signUpOutsider(page, seed, eventId, 'suggest');
        await page.goto(`/events/${eventId}`);
        const prompt = page.getByTestId('hub-join-prompt');
        await expect(prompt.getByText(`Join ${HUB}?`)).toBeVisible({ timeout: 20_000 });

        await prompt.getByRole('button', { name: 'Not now' }).click();
        await expect.poll(async () => (await eventPrompts(jwt, eventId)).length, { message: 'Not now must reach the API' }).toBe(0);
        await expect(page.getByTestId('hub-join-prompt'), 'Not now hides the prompt').toHaveCount(0);
        expect(await viewerOf(jwt, seed.gameId, seed.hubIds.crew), 'Not now does not join').toBe('not-member');
        const refetched = page.waitForResponse(
            (r) => new URL(r.url()).pathname.endsWith('/users/me/hub-join-prompts') && r.ok(),
            { timeout: 20_000 },
        );
        await page.reload();
        await refetched;
        await expect(page.getByTestId('hub-join-prompt'), '"Not now" sticks across a reload').toHaveCount(0);
    });

    test('auto: the signer is joined and the event page says "You joined Seed Crew"', async ({ page, world }, testInfo) => {
        const seed = await seedHubs(testInfo);
        await signInOnboardedMember(page, seed.leaderUserId);
        await setModeAsLeader(page, seed, 'Auto');
        const eventId = await createHubEvent(world, seed);

        const jwt = await signUpOutsider(page, seed, eventId, 'auto-joined');
        await expect.poll(() => viewerOf(jwt, seed.gameId, seed.hubIds.crew), {
            message: 'auto mode must join the signer',
        }).toBe('member');
        await page.goto(`/events/${eventId}`);
        const notice = page.getByTestId('hub-auto-joined');
        await expect(notice).toContainText(`You joined ${HUB}`, { timeout: 20_000 });
        await expect(notice.getByRole('link', { name: HUB })).toHaveAttribute('href', `/hubs/${seed.hubIds.crew}`);
    });
});
