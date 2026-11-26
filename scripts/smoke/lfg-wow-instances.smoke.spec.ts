/**
 * ROK-2352 — LFG for WoW dungeons and raids (Option B: one LFG group per
 * instance), desktop + mobile.
 *
 * W1 — `/lfg/<forever>` lists the instance groups (Dungeons + Raids sections),
 *      a dungeon row opens `/lfg/<slug>/<key>`, and the roster carries the
 *      per-member WoW badges (roles) from `members[].pluginDetail`.
 * W2 — "Find a time" on a dungeon group sends `?group=<key>` and converts
 *      only that group: the same members' hands in another group stay live.
 * W3 — "Start now" on a dungeon group is group-scoped (`?group=<key>`): the
 *      spawned event is titled with the instance and only that group converts.
 * W4 — the hub picker: the viewer's WoW hub is offered, picking it sets
 *      `?hub=<id>` + the "from <hub>" chip, and a reload without `?hub`
 *      restores the remembered pick (localStorage).
 * W5 — raise hands through the UI on the whole-game page: role chips gate the
 *      urgency pick, one dungeon + one raid checkbox → one `POST /lfg` per
 *      group, and both group rows read "1 looking".
 * W6 — Lock in this event on a dungeon group through the UI → the created
 *      event carries `slotConfig` mmo 1/1/3 and the dungeon in
 *      `contentInstances` (spec §3.4 / §6.2).
 * W7 — a non-WoW `/lfg/<slug>` renders no WoW grouping UI (regression).
 *
 * Isolation (review r1): the spawn/attach guard is per GROUP, but the
 * `playingNow` read on every group page is per GAME
 * (`lfg-query.helpers.ts` → `readPlayingNow(db, game.id)`), so one live
 * Start-now session puts EVERY Forever group page into the playing state.
 * W3 therefore runs on desktop only and last, its event id comes from the
 * start-now response (not `playingNow`), and every page-opening test first
 * waits until the game has no live session (`openAs`).
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (Forever, per project × worker ×
 * run name) → gm / officer / member, each onboarded with a character. Hands
 * are raised through the production `POST /lfg` with the members' own JWTs.
 * Instance keys come from `GET /lfg/:gameId/groups?include=catalogue`, never
 * from a hard-coded name; each project takes its OWN instances (offset by
 * project) because both projects share the Forever game and a convert /
 * start-now converts every hand of the group. Seeded users are deleted in
 * `finally` (their hands cascade) and the seeded hub is hidden (there is no
 * hub delete endpoint; the global reset-to-seed wipes it).
 */
import type { Browser, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const FOREVER_SLUG = 'world-of-warcraft-forever';
/** Per-project instance offset: desktop and mobile never share a group. */
const PROJECT_OFFSET: Record<string, number> = { desktop: 0, mobile: 3 };

type Role = 'gm' | 'officer' | 'member';
interface SeedUser { userId: number; characterId: string | null }
interface Seeded { guildId: number; gameId: number; name: string; users: Record<Role, SeedUser> }
interface RoleCounts { tank: number; healer: number; dps: number }
interface CatalogueGroup { groupKey: string; groupLabel: string | null; kind?: string; rosterShape?: RoleCounts | null }
interface Instances { dungeons: CatalogueGroup[]; raid: CatalogueGroup }

function must<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined) throw new Error(`[lfg-wow-instances] missing ${label}`);
    return value;
}

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `/lfg/<slug>/<key>` with the key raw or URL-encoded (the router may decode it). */
function groupUrlRe(key: string): RegExp {
    return new RegExp(`/lfg/${FOREVER_SLUG}/(${escapeRe(key)}|${escapeRe(encodeURIComponent(key))})(?:[?#]|$)`);
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<Seeded> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: `LFG WoW ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
        gameSlug: FOREVER_SLUG,
    })) as Partial<Seeded> | null;
    if (typeof body?.guildId !== 'number' || typeof body.gameId !== 'number' || !body.users || !body.name) {
        throw new Error(`[lfg-wow-instances] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, gameId: body.gameId, name: body.name, users: body.users };
}

/** This project's instances: 3 dungeons + 1 raid from the catalogue, offset per project. */
async function pickInstances(token: string, gameId: number, testInfo: TestInfo): Promise<Instances> {
    const res = (await apiGet(token, `/lfg/${gameId}/groups?include=catalogue`)) as { groups?: CatalogueGroup[] } | null;
    const groups = res?.groups ?? [];
    const offset = PROJECT_OFFSET[testInfo.project.name] ?? 0;
    // 5-player dungeons only, so W6's lock-in roster is the 1/1/3 the spec names.
    const fivePlayer = (g: CatalogueGroup): boolean =>
        !g.rosterShape || g.rosterShape.tank + g.rosterShape.healer + g.rosterShape.dps === 5;
    const dungeons = groups.filter((g) => g.kind === 'dungeon' && fivePlayer(g)).slice(offset, offset + 3);
    const raids = groups.filter((g) => g.kind === 'raid');
    const raid = raids[offset === 0 ? 0 : 1] ?? raids[0];
    if (dungeons.length < 3 || !raid) {
        throw new Error(`[lfg-wow-instances] catalogue too small: ${dungeons.length} dungeons, ${raids.length} raids`);
    }
    return { dungeons, raid };
}

/** A member's JWT via its own boot refresh, in a throwaway context. */
async function memberToken(browser: Browser, userId: number): Promise<string> {
    const context = await browser.newContext();
    try {
        return await signInOnboardedMember(await context.newPage(), userId);
    } finally {
        await context.close();
    }
}

async function raiseHand(token: string, gameId: number, groupKey: string, roles: string[], characterId?: string | null): Promise<void> {
    await apiPost(token, '/lfg', {
        gameId,
        urgency: 'week',
        groupKey,
        handDetail: { roles, ...(characterId ? { characterId } : {}) },
    });
}

/** Active member count of one group, read through the API (React Query's staleTime can lie). */
async function activeCount(token: string, gameId: number, groupKey: string): Promise<number> {
    const group = (await apiGet(token, `/lfg/${gameId}?group=${encodeURIComponent(groupKey)}`)) as { activeCount?: number } | null;
    return group?.activeCount ?? 0;
}

interface World { seeded: Seeded; instances: Instances; tokens: Record<Role, string>; admin: string }

/** Seed the guild, mint the three members' tokens, run `body`, delete the users. */
async function withWowLfg(browser: Browser, testInfo: TestInfo, body: (w: World) => Promise<void>): Promise<void> {
    const admin = await getAdminToken();
    const seeded = await seedGuild(admin, testInfo);
    try {
        const instances = await pickInstances(admin, seeded.gameId, testInfo);
        const tokens = {
            gm: await memberToken(browser, seeded.users.gm.userId),
            officer: await memberToken(browser, seeded.users.officer.userId),
            member: await memberToken(browser, seeded.users.member.userId),
        };
        await body({ seeded, instances, tokens, admin });
    } finally {
        for (const u of Object.values(seeded.users)) await apiDelete(admin, `/users/${u.userId}`).catch(() => undefined);
        await apiPatch(admin, `/guilds/${seeded.guildId}/hidden`, { hidden: true }).catch(() => undefined);
    }
}

/** gm (tank) + officer (healer) in dungeon A; member (dps) in dungeon B and the raid. */
async function raiseBaseHands(w: World): Promise<{ a: CatalogueGroup; b: CatalogueGroup }> {
    const { gameId, users } = w.seeded;
    const a = must(w.instances.dungeons[0], 'dungeon A');
    const b = must(w.instances.dungeons[1], 'dungeon B');
    await raiseHand(w.tokens.gm, gameId, a.groupKey, ['tank'], users.gm.characterId);
    await raiseHand(w.tokens.officer, gameId, a.groupKey, ['healer'], users.officer.characterId);
    await raiseHand(w.tokens.member, gameId, b.groupKey, ['dps'], users.member.characterId);
    await raiseHand(w.tokens.member, gameId, w.instances.raid.groupKey, ['dps']);
    await pollForCondition(
        async () => ((await activeCount(w.admin, gameId, a.groupKey)) === 2 ? true : null),
        { timeoutMs: 15_000, description: `dungeon A (${a.groupKey}) shows 2 active hands` },
    );
    return { a, b };
}

/** `GET /lfg/:gameId[?group]` through the API. */
async function readGroup(w: World, groupKey: string): Promise<{ activeCount?: number; playingNow?: { eventId: number } | null } | null> {
    const query = groupKey === '' ? '' : `?group=${encodeURIComponent(groupKey)}`;
    return (await apiGet(w.admin, `/lfg/${w.seeded.gameId}${query}`)) as { activeCount?: number; playingNow?: { eventId: number } | null } | null;
}

/**
 * Barrier: no live session on the game. `playingNow` is read per game, so the
 * desktop W3's Start-now session would draw the playing state (no hero, no
 * join row) on this page until W3 deletes its event.
 */
async function noLiveSession(w: World, groupKey: string): Promise<void> {
    await pollForCondition(
        async () => {
            const g = await readGroup(w, groupKey);
            return g !== null && g.playingNow == null ? true : null;
        },
        { timeoutMs: 120_000, intervalMs: 1_000, description: `no live Forever session before opening group "${groupKey}"` },
    );
}

/** Sign in as `role`, wait out any live session, open `/lfg/<forever>[/<key>]`. */
async function openAs(page: Page, w: World, role: Role, groupKey: string, query = ''): Promise<void> {
    await noLiveSession(w, groupKey);
    await signInOnboardedMember(page, w.seeded.users[role].userId);
    const path = groupKey === '' ? `/lfg/${FOREVER_SLUG}` : `/lfg/${FOREVER_SLUG}/${encodeURIComponent(groupKey)}`;
    await page.goto(`${path}${query}`);
}

async function openAsGm(page: Page, w: World, groupKey: string): Promise<void> {
    await openAs(page, w, 'gm', groupKey);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
    test.skip(
        test.info().project.name === 'tablet',
        'LFG specs run on desktop + mobile only (the tablet project shares the phone layout)',
    );
});

test('W1: the Forever LFG page lists dungeon + raid groups; a dungeon group shows role badges', async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await withWowLfg(browser, testInfo, async (w) => {
        const { a, b } = await raiseBaseHands(w);
        await openAsGm(page, w, '');

        const groups = page.getByTestId('wow-lfg-groups');
        await expect(groups, 'the WoW group list replaces the whole-game page').toBeVisible({ timeout: 20_000 });
        const dungeons = page.getByTestId('wow-lfg-dungeons');
        await expect(dungeons.locator(`[data-group-key="${a.groupKey}"]`)).toContainText('2 looking');
        await expect(dungeons.locator(`[data-group-key="${b.groupKey}"]`)).toContainText('1 looking');
        await expect(page.getByTestId('wow-lfg-raids').locator(`[data-group-key="${w.instances.raid.groupKey}"]`)).toBeVisible();

        await dungeons.locator(`[data-group-key="${a.groupKey}"] a`).click();
        await expect(page).toHaveURL(groupUrlRe(a.groupKey), { timeout: 15_000 });

        await page.getByTestId('lfg-participants-chip').click();
        const list = page.getByTestId('lfg-participants-list');
        await expect(list).toBeVisible({ timeout: 15_000 });
        const badges = list.getByTestId('wow-lfg-member-badges');
        await expect(badges, 'one badge row per member of dungeon A').toHaveCount(2);
        await expect(list).toContainText('tank');
        await expect(list).toContainText('healer');
        await expect(list, "dungeon B's dps hand is not in dungeon A").not.toContainText('dps');
    });
});

test('W2: Find a time on a dungeon group sends ?group and converts only that group', async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await withWowLfg(browser, testInfo, async (w) => {
        const { a, b } = await raiseBaseHands(w);
        // gm also holds a hand in dungeon B: it must survive A's convert.
        await raiseHand(w.tokens.gm, w.seeded.gameId, b.groupKey, ['tank']);
        await openAsGm(page, w, a.groupKey);

        const primary = page.getByTestId('lfg-hero-primary');
        await expect(primary).toBeEnabled({ timeout: 20_000 });
        await primary.click();
        await expect(page.getByTestId('lfg-poll-confirm')).toBeVisible({ timeout: 15_000 });
        const convert = page.waitForRequest(
            (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith(`/lfg/${w.seeded.gameId}/convert`),
            { timeout: 30_000 },
        );
        await page.getByTestId('lfg-poll-confirm-submit').click();
        const convertUrl = new URL((await convert).url());
        expect(convertUrl.searchParams.get('group'), 'the convert names the dungeon group').toBe(a.groupKey);
        await expect(page).toHaveURL(/\/community-lineup\/\d+\/schedule\/\d+$/, { timeout: 30_000 });

        await pollForCondition(
            async () => ((await activeCount(w.admin, w.seeded.gameId, a.groupKey)) === 0 ? true : null),
            { timeoutMs: 20_000, description: `dungeon A (${a.groupKey}) converted away` },
        );
        expect(await activeCount(w.admin, w.seeded.gameId, b.groupKey), "dungeon B keeps gm's and member's hands").toBe(2);
    });
});

test('W4: the hub picker offers the WoW hub, sets ?hub, and remembers the pick', async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await withWowLfg(browser, testInfo, async (w) => {
        await openAsGm(page, w, '');
        const picker = page.getByTestId('lfg-hub-picker');
        await expect(picker, "a viewer in a WoW hub sees the picker").toBeVisible({ timeout: 20_000 });
        const select = picker.getByRole('combobox', { name: 'Hub' });
        await select.selectOption(String(w.seeded.guildId));
        await expect(page).toHaveURL(new RegExp(`[?&]hub=${w.seeded.guildId}(?:&|$)`), { timeout: 15_000 });
        await expect(picker).toContainText(`from ${w.seeded.name}`);
        await expect(picker.getByRole('link', { name: `Back to ${w.seeded.name}` })).toHaveAttribute('href', new RegExp(`/hubs/${w.seeded.guildId}$`));

        // Reload WITHOUT ?hub: the remembered pick is restored into the URL.
        await page.goto(`/lfg/${FOREVER_SLUG}`);
        await expect(page).toHaveURL(new RegExp(`[?&]hub=${w.seeded.guildId}(?:&|$)`), { timeout: 15_000 });
        await expect(select).toHaveValue(String(w.seeded.guildId));
    });
});

/** Every hour of the week, so the two members' game time always overlaps. */
const ALL_WEEK_SLOTS = Array.from({ length: 7 * 24 }, (_, i) => ({ dayOfWeek: Math.floor(i / 24), hour: i % 24 }));

interface PostedHand { groupKey?: string; urgency?: string; handDetail?: { roles?: string[] } }

/** Every `POST /lfg` body the page sends from now on. */
function recordHandPosts(page: Page): PostedHand[] {
    const posted: PostedHand[] = [];
    page.on('request', (r) => {
        if (r.method() !== 'POST' || !new URL(r.url()).pathname.endsWith('/lfg')) return;
        try {
            posted.push(r.postDataJSON() as PostedHand);
        } catch {
            posted.push({});
        }
    });
    return posted;
}

test('W5: raising hands through the UI in a dungeon and a raid shows both on the group rows', async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    await withWowLfg(browser, testInfo, async (w) => {
        const dungeon = must(w.instances.dungeons[0], 'dungeon A');
        const raid = w.instances.raid;
        await openAs(page, w, 'member', '');
        const posted = recordHandPosts(page);

        await page.getByTestId('lfg-join-button').click();
        await expect(page.getByTestId('wow-lfg-raise-hand')).toBeVisible({ timeout: 20_000 });
        const week = page.getByTestId('lfg-urgency-week');
        await expect(week, 'the urgency pick waits for a role (fresh member, no last hand)').toBeDisabled();
        await page.getByTestId('wow-lfg-role-dps').click();
        await expect(week, 'a role makes the hand ready').toBeEnabled();

        await page.getByTestId('wow-lfg-instances-dungeons').getByTestId(`wow-lfg-instance-${dungeon.groupKey}`).check();
        await page.getByTestId('wow-lfg-instances-raids').getByTestId(`wow-lfg-instance-${raid.groupKey}`).check();
        await week.click();

        for (const key of [dungeon.groupKey, raid.groupKey]) {
            await pollForCondition(
                async () => ((await activeCount(w.admin, w.seeded.gameId, key)) === 1 ? true : null),
                { timeoutMs: 20_000, description: `group ${key} shows the member's UI-raised hand` },
            );
        }
        const keys = posted.map((p) => p.groupKey ?? '').sort();
        expect(keys, 'one POST /lfg per picked group, none for Any dungeon').toEqual([dungeon.groupKey, raid.groupKey].sort());
        for (const p of posted) expect(p.handDetail?.roles, `hand detail of ${p.groupKey}`).toEqual(['dps']);

        await expect(page.getByTestId('wow-lfg-dungeons').locator(`[data-group-key="${dungeon.groupKey}"]`)).toContainText('1 looking', { timeout: 15_000 });
        await expect(page.getByTestId('wow-lfg-raids').locator(`[data-group-key="${raid.groupKey}"]`)).toContainText('1 looking', { timeout: 15_000 });
    });
});

interface CreatedEvent { slotConfig?: Record<string, unknown> | null; contentInstances?: Record<string, unknown>[] | null }

test('W6: Lock in on a dungeon group creates an event with the 1/1/3 mmo roster and the dungeon', async ({ page, browser }, testInfo) => {
    test.setTimeout(180_000);
    await withWowLfg(browser, testInfo, async (w) => {
        const { a } = await raiseBaseHands(w);
        await apiPut(w.tokens.gm, '/users/me/game-time', { slots: ALL_WEEK_SLOTS });
        await apiPut(w.tokens.officer, '/users/me/game-time', { slots: ALL_WEEK_SLOTS });
        await pollForCondition(
            async () => {
                const o = (await apiGet(w.admin, `/lfg/${w.seeded.gameId}/overlap?group=${encodeURIComponent(a.groupKey)}`)) as { windows?: unknown[] } | null;
                return o?.windows?.length ? true : null;
            },
            { timeoutMs: 20_000, description: `dungeon A (${a.groupKey}) overlap has a shared window` },
        );
        await openAsGm(page, w, a.groupKey);

        const lockIn = page.getByTestId('lfg-lockin').first();
        await expect(lockIn).toBeEnabled({ timeout: 20_000 });
        await lockIn.click();
        await expect(page.getByTestId('lfg-lockin-confirm')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('wow-lfg-lockin-fields'), 'the WoW roster preview is in the confirm').toBeVisible();
        const created = page.waitForResponse(
            (res) => res.request().method() === 'POST' && /\/events$/.test(new URL(res.url()).pathname),
            { timeout: 30_000 },
        );
        await page.getByTestId('lfg-lockin-confirm-submit').click();
        const res = await created;
        const eventId = ((await res.json()) as { id?: number }).id;
        try {
            expect(res.ok(), 'POST /events succeeded').toBe(true);
            const sent = res.request().postDataJSON() as { lfgGroupKey?: string };
            expect(sent.lfgGroupKey, 'the lock-in names the dungeon group').toBe(a.groupKey);
            const event = (await apiGet(w.admin, `/events/${must(eventId, 'created event id')}`)) as CreatedEvent | null;
            expect(event?.slotConfig, 'a 5-player dungeon locks in as mmo 1/1/3').toMatchObject({ type: 'mmo', tank: 1, healer: 1, dps: 3 });
            const names = (event?.contentInstances ?? []).map((c) => c.name);
            expect(names, 'the dungeon is the event content').toContain(must(a.groupLabel, 'dungeon A label'));
        } finally {
            if (eventId !== undefined) await apiDelete(w.admin, `/events/${eventId}`).catch(() => undefined);
        }
    });
});

/** A catalogue game that is not WoW, for the regression step. */
async function nonWowSlug(token: string): Promise<string | null> {
    const discover = (await apiGet(token, '/games/discover')) as { rows?: { games?: { slug?: string | null }[] }[] } | null;
    for (const row of discover?.rows ?? []) {
        for (const game of row.games ?? []) {
            if (game.slug && !game.slug.includes('warcraft')) return game.slug;
        }
    }
    return null;
}

test('W7: a non-WoW LFG page renders no WoW grouping UI', async ({ page }) => {
    const slug = await nonWowSlug(await getAdminToken());
    test.skip(slug === null, 'the catalogue has no slugged non-WoW game');
    await page.goto(`/lfg/${must(slug, 'non-WoW slug')}`);
    await expect(page.getByTestId('lfg-header')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('lfg-hero').or(page.getByTestId('lfg-playing-state')).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wow-lfg-groups'), 'no WoW group list on a non-WoW game').toHaveCount(0);
    await expect(page.getByTestId('lfg-hub-picker'), 'no WoW hub picker on a non-WoW game').toHaveCount(0);
});

test('W3: Start now on a dungeon group is group-scoped and titles the event with the instance', async ({ page, browser }, testInfo) => {
    // Desktop only and last: `playingNow` is read per GAME, so a second
    // project's session would leak into this one's title/playing asserts and
    // into every other Forever page (see the header).
    test.skip(testInfo.project.name !== 'desktop', 'Start now runs once per suite (playingNow is per game)');
    test.setTimeout(120_000);
    await withWowLfg(browser, testInfo, async (w) => {
        const { gameId, users } = w.seeded;
        const c = must(w.instances.dungeons[2], 'dungeon C');
        const other = must(w.instances.dungeons[1], 'dungeon B');
        await raiseHand(w.tokens.gm, gameId, c.groupKey, ['tank'], users.gm.characterId);
        await raiseHand(w.tokens.officer, gameId, c.groupKey, ['healer']);
        await raiseHand(w.tokens.officer, gameId, other.groupKey, ['healer']);
        await openAsGm(page, w, c.groupKey);

        const startNow = page.getByTestId('lfg-hero-start-now');
        await expect(startNow).toBeEnabled({ timeout: 20_000 });
        await startNow.click();
        await expect(page.getByTestId('lfg-start-now-confirm')).toBeVisible({ timeout: 15_000 });
        const start = page.waitForResponse(
            (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/lfg/${gameId}/start-now`),
            { timeout: 30_000 },
        );
        await page.getByTestId('lfg-start-now-confirm-submit').click();
        const res = await start;
        // Claimed before the first assertion so `finally` always deletes it.
        const eventId = ((await res.json().catch(() => null)) as { eventId?: number } | null)?.eventId ?? null;
        try {
            const startUrl = new URL(res.url());
            expect(startUrl.searchParams.get('group'), 'Start now names the dungeon group (spec §3.8)').toBe(c.groupKey);
            expect(res.ok(), 'POST start-now succeeded').toBe(true);
            const event = (await apiGet(w.admin, `/events/${must(eventId, 'start-now eventId')}`)) as { title?: string } | null;
            expect(event?.title, 'the keyed start-now event is titled with the instance').toContain(must(c.groupLabel, 'dungeon C label'));
            expect(await activeCount(w.admin, gameId, other.groupKey), "officer's dungeon B hand is untouched").toBe(1);
        } finally {
            if (eventId !== null) await apiDelete(w.admin, `/events/${eventId}`).catch(() => undefined);
        }
    });
});
