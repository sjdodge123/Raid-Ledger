/**
 * ROK-1905 — the WoW: Forever guild hub widgets on a `wow_guild` hub's Overview:
 * Class breakdown (W1), Level progression (W2), Role breakdown (W3), Guild
 * professions (W4) and, ROK-1914, Who's saved (W6). Desktop AND mobile.
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785) with a per-project,
 * per-worker, per-run name — a Forever guild (the fixture's default slug) with
 * five live roster rows, every one a level-60 Warrior: three linked to seeded
 * members (gm tank, officer healer, member dps) and two unlinked. With
 * `withLockouts: true` (ROK-1914) each linked character also gets a LedgerLink
 * snapshot: Molten Core live on the GM + officer, Onyxia's Lair live on the
 * member, and an expired Blackwing Lair on the GM. The GM then
 * sets Tailoring on their own character through the ordinary
 * `PATCH /users/me/characters/:id` (manual professions). That write lands
 * BEFORE anything reads `/plugins/wow/guilds/:id/roster-insights`: the
 * endpoint caches each guild + audience for 5 minutes, so an earlier read
 * would pin a professions-less payload. The spec then polls the endpoint as
 * the GM until Tailoring and the lockouts show, and asserts the cards against
 * that payload.
 *
 * Nothing depends on an IGDB-rewritable name: the game is resolved by slug and
 * the cards by their registered titles. Seeded users are deleted in `finally`
 * (their characters go with them); the guild row stays, as in guild-page.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPatch, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

const GAME_SLUG = 'world-of-warcraft-forever';
/** seed-guild's roster: five level-60 Warriors (`demo-test-guild.helpers.ts` MEMBER_BASE). */
const SEEDED_CLASS = 'Warrior';
const SEEDED_ROSTER_SIZE = 5;
const SEEDED_LEVEL = 60;
const PROFESSION = 'Tailoring';
/** seed-guild `withLockouts` (`demo-test-guild-lockouts.helpers.ts`). */
const SHARED_SAVE = 'Molten Core';
const SOLO_SAVE = "Onyxia's Lair";
const EXPIRED_SAVE = 'Blackwing Lair';
const LINKED_COUNT = 3;

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededUser {
    userId: number;
    characterId: string | null;
}

interface SeededGuild {
    guildId: number;
    users: Record<Role, SeededUser>;
}

interface Insights {
    classes: { class: string; count: number; members: { name: string }[] }[];
    levels: { max: number | null; atCap: number };
    roles: { dungeon: Record<string, number>; raid: Record<string, number> };
    professions?: { name: string; members: { name: string }[] }[];
    lockouts?: { name: string; members: { name: string; killed: number }[] }[];
    freshness: { characters: { addon: number } };
}

let gameId: number | null = null;

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Forever ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
        gameSlug: GAME_SLUG,
        withLockouts: true,
    })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) {
        throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** The GM records Tailoring on their own (main) character — a manual professions fact. */
async function setGmProfession(gmJwt: string, characterId: string): Promise<void> {
    const professions = {
        primary: [{ id: 197, name: PROFESSION, slug: 'tailoring', skillLevel: 250, maxSkillLevel: 300, tiers: [] }],
        secondary: [],
        syncedAt: new Date().toISOString(),
    };
    const res = (await apiPatch(gmJwt, `/users/me/characters/${characterId}`, { professions })) as {
        professions?: unknown;
        message?: unknown;
    };
    expect(res.professions, `the GM's professions PATCH should save: ${JSON.stringify(res.message ?? res)}`).toBeTruthy();
}

/** Poll the roster insights as the GM until the profession and lockouts land (first read happens after the writes). */
async function waitForInsights(gmJwt: string, guildId: number): Promise<Insights> {
    return pollForCondition(
        async () => {
            const data = (await apiGet(gmJwt, `/plugins/wow/guilds/${guildId}/roster-insights`)) as Insights | null;
            const hasProfession = data?.professions?.some((p) => p.name === PROFESSION) ?? false;
            const hasLockouts = (data?.lockouts?.length ?? 0) > 0;
            return hasProfession && hasLockouts ? data : null;
        },
        { timeoutMs: 15_000, description: `roster-insights for guild ${guildId} lists ${PROFESSION} and lockouts` },
    );
}

function card(page: Page, title: string): Locator {
    return page.getByRole('region', { name: title, exact: true });
}

async function expectClassBreakdown(page: Page, insights: Insights): Promise<void> {
    const warriors = insights.classes.find((c) => c.class === SEEDED_CLASS);
    expect(warriors?.count, `the API counts the ${SEEDED_ROSTER_SIZE} seeded ${SEEDED_CLASS}s`).toBe(SEEDED_ROSTER_SIZE);
    const region = card(page, 'Class breakdown');
    await expect(region, 'the Class breakdown card renders on a Forever guild Overview').toBeVisible({ timeout: 20_000 });
    const bar = region.getByTestId(`forever-class-${SEEDED_CLASS}`);
    await expect(bar).toContainText(SEEDED_CLASS);
    await expect(bar).toContainText(String(SEEDED_ROSTER_SIZE));
    const fill = bar.locator('[role="meter"] > div');
    const box = await fill.boundingBox();
    expect(box?.width ?? 0, 'the largest class bar fill has a non-zero width (ROK-1921 zero-width regression)').toBeGreaterThan(0);
    await expect(bar).toHaveAttribute('aria-expanded', 'false');
    await bar.click();
    await expect(bar, 'a click expands the class bar').toHaveAttribute('aria-expanded', 'true');
    const list = region.getByTestId(`forever-class-members-${SEEDED_CLASS}`);
    await expect(list, 'the expanded bar lists its members').toBeVisible();
    await expect(list.getByRole('listitem'), 'one row per seeded Warrior').toHaveCount(SEEDED_ROSTER_SIZE);
    await expect(list).toContainText('Aldren');
}

async function expectLevelProgression(page: Page, insights: Insights): Promise<void> {
    expect(insights.levels.max, 'the API sees the seeded level').toBe(SEEDED_LEVEL);
    const region = card(page, 'Level progression');
    await expect(region, 'the Level progression card renders').toBeVisible({ timeout: 20_000 });
    await expect(region.getByTestId('forever-level-max')).toHaveText(String(SEEDED_LEVEL));
    await expect(region.getByTestId('forever-level-at-cap'), 'every seeded member is at cap').toHaveText(String(SEEDED_ROSTER_SIZE));
    await expect(region.getByTestId('forever-level-top').getByRole('listitem')).toHaveCount(SEEDED_ROSTER_SIZE);
}

async function expectRoleBreakdown(page: Page, insights: Insights): Promise<void> {
    const region = card(page, 'Role breakdown');
    await expect(region, 'the Role breakdown card renders').toBeVisible({ timeout: 20_000 });
    for (const role of ['tank', 'healer', 'dps'] as const) {
        const count = insights.roles.dungeon[role] ?? 0;
        expect(count, `the seeded ${role} counts as dungeon-ready`).toBeGreaterThanOrEqual(1);
        await expect(region.getByTestId(`forever-roles-dungeon-${role}`)).toContainText(String(count));
    }
}

async function expectProfessions(page: Page): Promise<void> {
    const region = card(page, 'Guild professions');
    await expect(region, 'a guild member sees the Guild professions card').toBeVisible({ timeout: 20_000 });
    const row = region.getByRole('button', { name: new RegExp(PROFESSION) });
    await expect(row, `the GM's ${PROFESSION} is listed`).toBeVisible();
    await row.click();
    await expect(region.getByRole('list', { name: `${PROFESSION} members` })).toContainText('Aldren');
}

function expectLockoutsPayload(insights: Insights): void {
    const groups = (insights.lockouts ?? []).map((g) => [g.name, g.members.map((m) => `${m.name} ${m.killed}`)]);
    expect(groups, 'the API groups the shared save first and drops the expired one').toEqual([
        [SHARED_SAVE, ['Aldren 10', 'Brisa 4']],
        [SOLO_SAVE, ['Dainel 1']],
    ]);
    expect(insights.freshness.characters.addon, 'every linked character reports an addon export').toBe(LINKED_COUNT);
}

async function expectWhosSaved(page: Page, insights: Insights): Promise<void> {
    expectLockoutsPayload(insights);
    const region = card(page, "Who's saved");
    await expect(region, "a guild member sees the Who's saved card").toBeVisible({ timeout: 20_000 });
    const list = region.getByRole('list', { name: 'Saved instances' });
    await expect(list.getByRole('button'), 'one row per live save').toHaveCount(2);
    const shared = list.getByRole('button', { name: new RegExp(SHARED_SAVE) });
    await expect(shared).toContainText('2 saved');
    await expect(shared, 'the row shows the reset countdown').toContainText(/Resets in \d+d \d+h/);
    await expect(list.getByRole('button', { name: new RegExp(SOLO_SAVE) })).toContainText('1 saved');
    await expect(region.getByText(EXPIRED_SAVE), 'an expired save is never listed').toHaveCount(0);
    await expect(shared).toHaveAttribute('aria-expanded', 'false');
    await shared.click();
    await expect(shared, 'a click expands the instance').toHaveAttribute('aria-expanded', 'true');
    const members = region.getByRole('list', { name: `${SHARED_SAVE} saved members` });
    await expect(members.getByRole('link'), 'both saved characters link to their pages').toHaveCount(2);
    await expect(members.getByRole('link', { name: 'Aldren' })).toHaveAttribute('href', /\/characters\//);
    await expect(members.getByTestId('whos-saved-kills')).toHaveText(['10/10', '4/10']);
    await expect(region.getByTestId('whos-saved-footer')).toHaveText(`Based on ${LINKED_COUNT} members' addon exports`);
}

test.describe('WoW: Forever guild hub widgets (ROK-1905)', () => {
    test.beforeAll(async () => {
        const token = await getAdminToken();
        const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameId = game?.id ?? null;
    });

    test.beforeEach(() => {
        test.skip(gameId === null, `"${GAME_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test("Overview: class, level, role, professions and Who's saved cards render the seeded roster", async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const guild = await seedGuild(token, testInfo);
        try {
            const gmChar = guild.users.gm.characterId;
            if (gmChar === null) throw new Error('seed-guild: the GM should own a linked character');
            const gmJwt = await signInOnboardedMember(page, guild.users.gm.userId);
            await setGmProfession(gmJwt, gmChar);
            const insights = await waitForInsights(gmJwt, guild.guildId);
            await page.goto(`/hubs/${guild.guildId}`);
            await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
            await expectClassBreakdown(page, insights);
            await expectLevelProgression(page, insights);
            await expectRoleBreakdown(page, insights);
            await expectProfessions(page);
            await expectWhosSaved(page, insights);
        } finally {
            await removeUsers(token, guild);
        }
    });
});
