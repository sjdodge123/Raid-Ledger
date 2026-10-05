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
 * Seed: the demo seed installed by global setup (`reset-to-seed`) — the spec
 * picks the first upcoming event whose roster has a Discord-linked member
 * with an avatar hash, so it mutates nothing.
 */
import { test, expect } from './base';
import { getAdminToken, apiGet, API_BASE } from './api-helpers';
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

/** First upcoming demo event with a Discord-linked roster member who has an avatar. */
async function findSeededEvent(token: string): Promise<{ eventId: number; member: RosterUser; detail: Detail }> {
    const list = (await apiGet(token, '/events?upcoming=true&limit=50')) as { data: Array<{ id: number }> } | null;
    for (const { id } of list?.data ?? []) {
        const detail = (await apiGet(token, `/events/${id}/detail`)) as Detail | null;
        const signup = detail?.roster.signups.find((s) => s.user.id > 0 && cdnAvatarUrl(s.user));
        if (detail && signup) return { eventId: id, member: signup.user, detail };
    }
    throw new Error('demo seed has no upcoming event with a Discord-linked, avatar-bearing roster member');
}

let seeded: { eventId: number; member: RosterUser; detail: Detail };

test.beforeAll(async () => {
    seeded = await findSeededEvent(await getAdminToken());
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
