/**
 * ROK-2185 guild page polish smoke — every project (desktop, tablet, mobile).
 *
 * Each test seeds its OWN WoW guild through `POST /admin/test/wow/seed-guild`
 * (per-project, per-worker, per-run name; GM + officer + member linked, an
 * outsider with no membership). No new fixture:
 *   - member phrase: the outsider signs the first "Molten Core Night" through
 *     `POST /admin/test/signup`, so the card has member AND non-member signups;
 *   - past paging: 25 ended events are created through the REAL `POST /events`
 *     (tagged to the guild) and pushed into the past with
 *     `POST /admin/test/set-event-times`; titles carry `world.uid`, so the
 *     `world` fixture's prefix-scoped `reset-events` removes them;
 *   - mirror: a fabricated channel with 6 messages through
 *     `POST /admin/test/wow/guild-discord-channel`, bound through the real PUT.
 * Seeded users are deleted in `finally`; the guild row stays (disposable env).
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, type TestWorld } from './base';
import { apiDelete, apiGet, apiPost, apiPut, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    gameId: number;
    users: Record<Role, { userId: number }>;
    raids: { seriesEventIds: number[]; pastEventId: number };
}

interface UpcomingCard { id: number; signupCount: number; memberSignupCount?: number }

const DAY = 86_400_000;
/** Seeded ended events; with the fixture's own "Onyxia Clear" the hub has 26 ended (pages of 20: 20 + 6). */
const PAST_COUNT = 25;
const TOTAL_ENDED = PAST_COUNT + 1;

function guildName(testInfo: TestInfo): string {
    return `Polish ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || typeof body.gameId !== 'number' || !body.users || !body.raids) {
        throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, gameId: body.gameId, users: body.users, raids: body.raids };
}

/** Seed a guild, run `body`, and always delete the seeded users. */
async function withGuild(testInfo: TestInfo, body: (token: string, guild: SeededGuild) => Promise<void>): Promise<void> {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        await body(token, guild);
    } finally {
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

/** One guild-tagged event through the real create route, then moved `daysAgo` into the past. */
async function createEndedEvent(token: string, guild: SeededGuild, title: string, daysAgo: number): Promise<void> {
    const future = new Date(Date.now() + 3 * DAY);
    const event = (await apiPost(token, '/events', {
        title, gameId: guild.gameId, guildId: guild.guildId, maxAttendees: 10,
        startTime: future.toISOString(), endTime: new Date(future.getTime() + 2 * 3_600_000).toISOString(),
    })) as { id?: unknown } | null;
    if (typeof event?.id !== 'number') throw new Error(`POST /events: ${JSON.stringify(event)}`);
    const start = new Date(Date.now() - daysAgo * DAY);
    await apiPost(token, '/admin/test/set-event-times', {
        eventId: event.id, startTime: start.toISOString(), endTime: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
    });
}

/** Seed {@link PAST_COUNT} ended events and wait until the past route pages them (20 + more). */
async function seedPastEvents(token: string, guild: SeededGuild, world: TestWorld): Promise<void> {
    for (let i = 0; i < PAST_COUNT; i += 1) {
        await createEndedEvent(token, guild, world.uid('past'), i + 2);
    }
    await pollForCondition(async () => {
        const page = (await apiGet(token, `/guilds/${guild.guildId}/events/past`)) as { events?: unknown[]; nextCursor?: string | null } | null;
        return page?.events?.length === 20 && typeof page.nextCursor === 'string' ? page : null;
    }, { description: `past events of guild ${guild.guildId}` });
}

async function openEvents(page: Page, guild: SeededGuild, role: Role): Promise<void> {
    await signInOnboardedMember(page, guild.users[role].userId);
    await page.goto(`/hubs/${guild.guildId}#events`);
    await expect(page.getByTestId('guild-events-tab')).toBeVisible({ timeout: 15_000 });
}

test('upcoming card names how many signups are guild members', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (token, guild) => {
        const eventId = guild.raids.seriesEventIds[0];
        if (eventId === undefined) throw new Error('seed-guild returned no series nights');
        const signup = (await apiPost(token, '/admin/test/signup', { eventId, userId: guild.users.outsider.userId })) as { id?: unknown } | null;
        if (typeof signup?.id !== 'number') throw new Error(`outsider signup: ${JSON.stringify(signup)}`);
        const card = await pollForCondition(async () => {
            const raids = (await apiGet(token, `/guilds/${guild.guildId}/raids`)) as { upcoming?: UpcomingCard[] } | null;
            const c = raids?.upcoming?.find((e) => e.id === eventId);
            return c && c.memberSignupCount !== undefined && c.memberSignupCount < c.signupCount ? c : null;
        }, { description: 'the outsider signup counts as a signup but not a member' });
        await openEvents(page, guild, 'member');
        const k = card.memberSignupCount ?? -1;
        const phrase = `${card.signupCount} / `;
        const member = `· ${k} guild member${k === 1 ? '' : 's'}`;
        const cards = page.getByTestId('guild-upcoming-event').filter({ hasText: /guild members?/ });
        await expect(cards, 'only the night with signups names a member count').toHaveCount(1, { timeout: 15_000 });
        await expect(cards.first()).toContainText(phrase);
        await expect(cards.first(), `the card says "${member}"`).toContainText(member);
    });
});

test('Events tab: Show more pages back through every ended event, then goes away', async ({ page, world }, testInfo) => {
    await withGuild(testInfo, async (token, guild) => {
        await seedPastEvents(token, guild, world);
        await openEvents(page, guild, 'member');
        const rows = page.getByTestId('guild-events-tab').getByTestId('guild-recent-event');
        const more = page.getByTestId('guild-past-events-more');
        await expect(more, 'older events exist, so Show more is offered').toBeVisible({ timeout: 15_000 });
        const before = await rows.count();
        expect(before, 'the first rows are the 8-week recent list (1-10)').toBeGreaterThan(0);
        expect(before, 'the first rows are the 8-week recent list (1-10)').toBeLessThanOrEqual(10);
        await more.click();
        await expect(rows, 'one click reveals the newest page of 20').toHaveCount(20);
        await expect(more).toBeEnabled({ timeout: 15_000 });
        await more.click();
        await expect(rows, 'the second click loads the older page: every ended event').toHaveCount(TOTAL_ENDED, { timeout: 15_000 });
        await expect(more, 'nothing older is left, so the button goes').toHaveCount(0);
    });
});

test('Events tab: a visitor (non-member) gets no Show more', async ({ page, world }, testInfo) => {
    await withGuild(testInfo, async (token, guild) => {
        await seedPastEvents(token, guild, world);
        await openEvents(page, guild, 'outsider');
        const rows = page.getByTestId('guild-events-tab').getByTestId('guild-recent-event');
        await expect(rows.first(), 'the visitor still sees the recent list').toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-past-events-more'), 'the past route is members-only').toHaveCount(0);
    });
});

/** A 17-digit snowflake unique to this run, worker and project. */
function channelIdFor(testInfo: TestInfo): string {
    return `8${Date.now()}${String(testInfo.workerIndex % 100).padStart(2, '0')}${testInfo.project.name.length % 10}`;
}

const MESSAGES = [1, 2, 3, 4, 5, 6].map((n) => ({ content: `Polish smoke message ${n}` }));

test('Discord mirror: Show more / Show less and Refresh on a bound channel with 6 messages', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (token, guild) => {
        const channelId = channelIdFor(testInfo);
        try {
            const reg = (await apiPost(token, '/admin/test/wow/guild-discord-channel', {
                channelId, name: `polish-${channelId.slice(-4)}`, messages: MESSAGES,
            })) as { read?: { state?: string } };
            if (reg.read?.state !== 'ok') throw new Error(`guild-discord-channel: ${JSON.stringify(reg)}`);
            const bind = (await apiPut(token, `/plugins/wow/guilds/${guild.guildId}/discord/channel`, { channelId })) as { state?: string };
            if (bind.state !== 'ok') throw new Error(`bind: ${JSON.stringify(bind)}`);
            await signInOnboardedMember(page, guild.users.member.userId);
            await page.goto(`/hubs/${guild.guildId}`);
            const card = page.getByTestId('guild-discord-mirror');
            await expect(card).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
            const rows = card.getByTestId('guild-discord-messages').getByTestId('thread-message-row');
            const toggle = card.getByTestId('guild-discord-show-more');
            await expect(rows, 'the latest 3 by default').toHaveCount(3);
            await expect(toggle).toHaveText('Show more');
            await toggle.click();
            await expect(rows, 'expanded shows every fetched message').toHaveCount(6);
            await expect(card).toContainText('Polish smoke message 1');
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await toggle.click();
            await expect(rows, 'Show less returns to 3').toHaveCount(3);
            await expect(toggle).toHaveText('Show more');
            const refresh = card.getByTestId('guild-discord-refresh');
            await expect(refresh).toBeEnabled();
            const reread = page.waitForResponse((r) =>
                r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/guilds/${guild.guildId}/discord`));
            await refresh.click();
            expect((await reread).status(), 'Refresh re-reads the mirror').toBe(200);
            await expect(card).toHaveAttribute('data-state', 'ok');
            await expect(rows).toHaveCount(3);
        } finally {
            await apiDelete(token, `/plugins/wow/guilds/${guild.guildId}/discord/channel`).catch(() => undefined);
            await apiPost(token, '/admin/test/wow/guild-discord-channel', { channelId, remove: true }).catch(() => undefined);
        }
    });
});
