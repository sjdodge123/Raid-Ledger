/**
 * ROK-1629 — public roster routes stop serving Discord ids to anonymous callers.
 *
 * The web `/events/:id` page sits behind AuthGuard, so a logged-out BROWSER is
 * redirected to login before it asks for the roster; the anonymous surface is
 * the API itself (`OptionalJwtGuard`, also hit by a member whose token has
 * expired). So:
 *  - anonymous: `GET /events/:id/detail` with no token carries no Discord id
 *    key at ANY depth, and a roster member's avatar is a server-built URL;
 *  - signed-in: the event detail page still renders roster names and avatars
 *    from the member payload (intercepted with `page.waitForResponse`).
 *
 * Fixture: the spec builds its own. The demo seed's gamers carry an avatar
 * hash but no Discord id, so `beforeAll` links the seeded gamer
 * `FIXTURE_USERNAME` to a fixed fake snowflake via `/admin/test/link-discord`
 * (idempotent — same user + snowflake on every project/run) AFTER muting the
 * gamer's Discord DM channel (impersonate → PATCH /notifications/preferences):
 * a DM to the fake snowflake gets 10013 and the DM processor DEACTIVATES the
 * user (observed on the fleet — seed gamers receive subscribed_game/reminder
 * notifications within seconds), which would cancel the signup and hide the
 * gamer from every later spec. It then creates a
 * future event, and signs the gamer up via `/admin/test/signup`. `afterAll`
 * deletes the event. The link itself has no DEMO_MODE undo (DELETE
 * /users/me/discord would also wipe the seeded avatar), so it stays until the
 * next `reset-to-seed`; no other smoke spec references this gamer.
 */
import { test, expect } from './base';
import { getAdminToken, apiGet, apiPost, apiPatch, apiDelete, pollForCondition, API_BASE } from './api-helpers';
import { fetchWithRetry } from './fetch-retry';

const DISCORD_KEYS = new Set(['discordId', 'discordUserId', 'discordAvatarHash']);
/** 1x1 transparent PNG so CDN avatars load deterministically in CI (no Discord egress). */
const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);

type RosterUser = { id: number; username: string; avatar: string | null; discordId?: string | null };
type RosterSignup = { user: RosterUser; character?: { avatarUrl?: string | null } | null };
type Detail = { roster: { signups: RosterSignup[] } };

/** Every `a.b[2].c` path whose key is a Discord identity field. */
function discordKeyPaths(value: unknown, path = '$'): string[] {
    if (Array.isArray(value)) return value.flatMap((v, i) => discordKeyPaths(v, `${path}[${i}]`));
    if (value === null || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([k, v]) => [
        ...(DISCORD_KEYS.has(k) ? [`${path}.${k}`] : []),
        ...discordKeyPaths(v, `${path}.${k}`),
    ]);
}

function cdnAvatarUrl(user: RosterUser): string | null {
    if (!user.avatar) return null;
    if (user.avatar.startsWith('http')) return user.avatar;
    if (!user.discordId || !/^\d+$/.test(user.discordId)) return null;
    return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`;
}

/** A demo-seed gamer (`ORIGINAL_GAMERS` in api/src/admin/demo-data.constants.ts) with a fixed avatar hash. */
const FIXTURE_USERNAME = 'DragonSlayer99';
/** Fake but well-formed snowflake (link-discord requires 17–20 digits); never a real Discord account. */
const FIXTURE_SNOWFLAKE = '162900000000000001';

type Seeded = { eventId: number; member: RosterUser; detail: Detail };

async function findFixtureUserId(token: string): Promise<number> {
    const list = (await apiGet(token, `/users?search=${FIXTURE_USERNAME}&limit=20`)) as
        { data: Array<{ id: number; username: string }> } | null;
    const user = list?.data.find((u) => u.username === FIXTURE_USERNAME);
    if (!user) throw new Error(`demo seed user ${FIXTURE_USERNAME} not found: ${JSON.stringify(list).slice(0, 200)}`);
    return user.id;
}

type Prefs = { channelPrefs: Record<string, Record<string, boolean>> };

/** Turn off every Discord DM for the gamer, as the gamer, and assert none is left on. */
async function muteDiscordDms(adminToken: string, userId: number): Promise<void> {
    const imp = (await apiPost(adminToken, `/auth/impersonate/${userId}`)) as { access_token?: string };
    if (!imp.access_token) throw new Error(`impersonate ${userId} returned no token: ${JSON.stringify(imp).slice(0, 200)}`);
    const before = (await apiGet(imp.access_token, '/notifications/preferences')) as Prefs | null;
    const channelPrefs = Object.fromEntries(Object.keys(before?.channelPrefs ?? {}).map((t) => [t, { discord: false }]));
    const after = (await apiPatch(imp.access_token, '/notifications/preferences', { channelPrefs })) as Prefs | null;
    const stillOn = Object.entries(after?.channelPrefs ?? {}).filter(([, c]) => c.discord).map(([t]) => t);
    if (!after || Object.keys(channelPrefs).length === 0 || stillOn.length > 0) {
        throw new Error(`Discord DMs not muted for user ${userId}; still on: ${stillOn.join(',') || '(no prefs returned)'}`);
    }
}

/** Discord-link the seeded gamer (keeps its seeded avatar hash) and assert the link landed. */
async function linkFixtureUser(token: string, userId: number): Promise<void> {
    await apiPost(token, '/admin/test/link-discord', {
        userId, discordId: FIXTURE_SNOWFLAKE, username: FIXTURE_USERNAME,
    });
    const profile = (await apiGet(token, `/users/${userId}/profile`)) as
        { data: { discordId: string | null; avatar: string | null } } | null;
    if (profile?.data.discordId !== FIXTURE_SNOWFLAKE || !profile.data.avatar) {
        throw new Error(`link-discord did not yield a linked, avatar-bearing user: ${JSON.stringify(profile?.data)}`);
    }
}

async function createFixtureEvent(token: string, project: string): Promise<number> {
    const start = new Date(Date.now() + 30 * 86_400_000);
    const event = (await apiPost(token, '/events', {
        title: `smoke-rok-1629-public-roster-${project}-${Date.now()}`,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
        maxAttendees: 10,
    })) as { id?: number };
    if (!event.id) throw new Error(`POST /events returned no id: ${JSON.stringify(event)}`);
    return event.id;
}

/** The member payload's roster entry for the fixture user, once the signup is visible. */
async function awaitRosterMember(token: string, eventId: number, userId: number): Promise<Seeded> {
    return pollForCondition(async () => {
        const detail = (await apiGet(token, `/events/${eventId}/detail`)) as Detail | null;
        const member = detail?.roster.signups.find((s) => s.user.id === userId)?.user;
        return detail && member && cdnAvatarUrl(member) ? { eventId, member, detail } : null;
    }, { description: `fixture user ${userId} on event ${eventId} roster with a CDN avatar` });
}

let seeded: Seeded;
let fixtureEventId: number | null = null;

test.beforeAll(async ({}, testInfo) => {
    const token = await getAdminToken();
    const userId = await findFixtureUserId(token);
    await muteDiscordDms(token, userId); // BEFORE the link — see header
    await linkFixtureUser(token, userId);
    fixtureEventId = await createFixtureEvent(token, testInfo.project.name); // claimed before any assertion
    await apiPost(token, '/admin/test/signup', { eventId: fixtureEventId, userId });
    seeded = await awaitRosterMember(token, fixtureEventId, userId);
});

test.afterAll(async () => {
    if (fixtureEventId !== null) await apiDelete(await getAdminToken(), `/events/${fixtureEventId}`);
});

test.describe('Public event roster — anonymous API caller (ROK-1629)', () => {
    test('/events/:id/detail carries no Discord id at any depth and a server-built avatar', async () => {
        const res = await fetchWithRetry(`${API_BASE}/events/${seeded.eventId}/detail`, {});
        expect(res.status, 'anonymous /detail must stay public').toBe(200);
        const body = (await res.json()) as Detail;

        expect(discordKeyPaths(body), 'anonymous /detail leaked Discord id keys at these paths').toEqual([]);
        const member = body.roster.signups.find((s) => s.user.id === seeded.member.id)?.user;
        expect(member?.username, 'the seeded member is still listed by name').toBe(seeded.member.username);
        expect(member?.avatar, 'the avatar is the server-built CDN URL').toBe(cdnAvatarUrl(seeded.member));
    });
});

test.describe('Public event roster — signed-in member page (ROK-1629)', () => {
    test('event detail renders roster names and avatars from the member payload', async ({ page }) => {
        await page.route('https://cdn.discordapp.com/**', (route) =>
            route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
        );
        const detailResponse = page.waitForResponse(
            (r) => r.url().includes(`/events/${seeded.eventId}/detail`) && r.request().method() === 'GET',
        );
        await page.goto(`/events/${seeded.eventId}`);
        const body = (await (await detailResponse).json()) as Detail;
        expect(discordKeyPaths(body).length, 'the member payload keeps Discord ids').toBeGreaterThan(0);

        await expect(page.getByText(seeded.member.username).first()).toBeVisible({ timeout: 15_000 });
        const avatarSrcs = body.roster.signups.flatMap((s) => [cdnAvatarUrl(s.user), s.character?.avatarUrl ?? null])
            .filter((src): src is string => !!src);
        await expect
            .poll(
                () => page.evaluate((srcs) => [...document.querySelectorAll('img')]
                    .filter((img) => srcs.includes(img.getAttribute('src') ?? '') && img.getClientRects().length > 0)
                    .length, avatarSrcs),
                { message: 'at least one roster avatar <img> renders', timeout: 15_000 },
            )
            .toBeGreaterThan(0);
    });
});
