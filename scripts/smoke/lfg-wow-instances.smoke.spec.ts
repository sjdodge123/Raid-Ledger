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
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (Forever, per project × worker ×
 * run name) → gm / officer / member, each onboarded with a character. Hands
 * are raised through the production `POST /lfg` with the members' own JWTs.
 * Instance keys come from `GET /lfg/:gameId/groups?include=catalogue`, never
 * from a hard-coded name; each project takes its OWN instances (offset by
 * project) because both projects share the Forever game and a convert /
 * start-now converts every hand of the group. Seeded users are deleted in
 * `finally` (their hands cascade).
 */
import type { Browser, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const FOREVER_SLUG = 'world-of-warcraft-forever';
/** Per-project instance offset: desktop and mobile never share a group. */
const PROJECT_OFFSET: Record<string, number> = { desktop: 0, mobile: 3 };

type Role = 'gm' | 'officer' | 'member';
interface SeedUser { userId: number; characterId: string | null }
interface Seeded { guildId: number; gameId: number; name: string; users: Record<Role, SeedUser> }
interface CatalogueGroup { groupKey: string; groupLabel: string | null; kind?: string }
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
    const dungeons = groups.filter((g) => g.kind === 'dungeon').slice(offset, offset + 3);
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

async function openAsGm(page: Page, w: World, path: string): Promise<void> {
    await signInOnboardedMember(page, w.seeded.users.gm.userId);
    await page.goto(path);
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
        await openAsGm(page, w, `/lfg/${FOREVER_SLUG}`);

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
        await openAsGm(page, w, `/lfg/${FOREVER_SLUG}/${encodeURIComponent(a.groupKey)}`);

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

test('W3: Start now on a dungeon group is group-scoped and titles the event with the instance', async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await withWowLfg(browser, testInfo, async (w) => {
        const { gameId, users } = w.seeded;
        const c = must(w.instances.dungeons[2], 'dungeon C');
        const other = must(w.instances.dungeons[1], 'dungeon B');
        await raiseHand(w.tokens.gm, gameId, c.groupKey, ['tank'], users.gm.characterId);
        await raiseHand(w.tokens.officer, gameId, c.groupKey, ['healer']);
        await raiseHand(w.tokens.officer, gameId, other.groupKey, ['healer']);
        await openAsGm(page, w, `/lfg/${FOREVER_SLUG}/${encodeURIComponent(c.groupKey)}`);

        const startNow = page.getByTestId('lfg-hero-start-now');
        await expect(startNow).toBeEnabled({ timeout: 20_000 });
        await startNow.click();
        await expect(page.getByTestId('lfg-start-now-confirm')).toBeVisible({ timeout: 15_000 });
        const start = page.waitForRequest(
            (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith(`/lfg/${gameId}/start-now`),
            { timeout: 30_000 },
        );
        await page.getByTestId('lfg-start-now-confirm-submit').click();
        const startUrl = new URL((await start).url());
        expect(startUrl.searchParams.get('group'), 'Start now names the dungeon group (spec §3.8)').toBe(c.groupKey);

        let eventId: number | null = null;
        try {
            const playing = await pollForCondition(
                async () => {
                    const g = (await apiGet(w.admin, `/lfg/${gameId}?group=${encodeURIComponent(c.groupKey)}`)) as { playingNow?: { eventId: number } | null } | null;
                    return g?.playingNow ?? null;
                },
                { timeoutMs: 30_000, description: `dungeon C (${c.groupKey}) reports playingNow` },
            );
            eventId = playing.eventId;
            const event = (await apiGet(w.admin, `/events/${eventId}`)) as { title?: string } | null;
            expect(event?.title, 'the keyed start-now event is titled with the instance').toContain(must(c.groupLabel, 'dungeon C label'));
            expect(await activeCount(w.admin, gameId, other.groupKey), "officer's dungeon B hand is untouched").toBe(1);
        } finally {
            if (eventId !== null) await apiDelete(w.admin, `/events/${eventId}`).catch(() => undefined);
        }
    });
});

test('W4: the hub picker offers the WoW hub, sets ?hub, and remembers the pick', async ({ page, browser }, testInfo) => {
    test.setTimeout(120_000);
    await withWowLfg(browser, testInfo, async (w) => {
        await openAsGm(page, w, `/lfg/${FOREVER_SLUG}`);
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
