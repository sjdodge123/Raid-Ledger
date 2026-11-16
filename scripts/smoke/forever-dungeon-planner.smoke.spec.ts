/**
 * ROK-2216 — the WoW: Forever guild hub's Dungeon planner tab (`#dungeon-planner`).
 * Every project: desktop picks the dungeon from the "Dungeons" list, tablet and
 * phone (<1024px) from the native "Dungeon" select.
 *
 * P1 — a member opening `#dungeon-planner` lands on the active tab, after Raids.
 * P2 — a non-member who can view the hub sees the tab and the picked claimed
 *      characters' quest chips. A Forever guild's seeded `outsider` gets the
 *      ROK-2132 join gate instead of the page, so the viewer is the site admin
 *      (staff, not a guild member) — the storageState session.
 * P3 — a member picks the dungeon + 2 claimed + 1 unclaimed character; opening
 *      the copied link (the URL is the plan) restores the dungeon and 3 chips,
 *      the unclaimed one greyed "no quest data".
 * P4 — "Create event & invite these 2" carries the 2 claimed ids; plain
 *      "Create event ▸" carries only the dungeon; the invite link pre-fills the
 *      Create Event form's "Will invite" line (ROK-2215 is merged).
 * P5 — the Alliance guild's Horde-only dungeon quest is absent and the
 *      guild-worded hidden-count note shows.
 *
 * Fixture: `POST /admin/test/wow/seed-guild {withDungeonPlan:true}` (ROK-2216
 * lane 4a) per test, with a per-project, per-worker, per-run name and a random
 * `rosterSuffix` (a concurrent claim spec never hides these roster names). It
 * reads the dungeon quests the WoW plugin seeds — the env needs them — and
 * answers `dungeonPlan` (dungeon D, gm/officer/member claimed characters A/B/C,
 * unclaimed member ids, the S2 `planPath`). Seeded users are deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { expectActiveHubTab, tabOrder } from './hub-tabs';
import { isDesktop } from './helpers';

type Role = 'gm' | 'officer' | 'member' | 'outsider';
interface PlanCharacter { characterId: string; memberId: number; completedQuestIds: number[] }
interface DungeonPlanSeed {
    instanceId: number;
    instanceName: string;
    hiddenQuestId: number;
    shownQuestIds: number[];
    characters: Record<'gm' | 'officer' | 'member', PlanCharacter>;
    unlinkedMemberIds: number[];
    planPath: string;
}
interface Seeded { guildId: number; gameId: number; users: Record<Role, { userId: number }>; dungeonPlan: DungeonPlanSeed; suffix: string }

const TAB_ID = 'dungeon-planner';

function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[forever-dungeon-planner] missing ${label}`);
    return value;
}

/** Six random letters: this seed's roster names are its own. */
function rosterSuffix(): string {
    return Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
}

/** A seed-guild roster name (`SEED_GUILD_ROSTER`) with this seed's suffix. */
function rosterName(seed: Seeded, base: 'Aldren' | 'Brisa' | 'Corvin' | 'Dainel'): string {
    return `${base}${seed.suffix}`;
}

async function seed(token: string, testInfo: TestInfo): Promise<Seeded> {
    const suffix = rosterSuffix();
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: `Planner ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`,
        rosterSuffix: suffix,
        withDungeonPlan: true,
    })) as Partial<Seeded> | null;
    if (typeof body?.guildId !== 'number' || typeof body.gameId !== 'number' || !body.users || !body.dungeonPlan) {
        throw new Error(`[forever-dungeon-planner] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, gameId: body.gameId, users: body.users, dungeonPlan: body.dungeonPlan, suffix };
}

/** Seed, run `body`, always delete the seeded users. */
async function withPlanGuild(testInfo: TestInfo, body: (s: Seeded) => Promise<void>): Promise<void> {
    const token = await getAdminToken();
    const seeded = await seed(token, testInfo);
    try {
        await body(seeded);
    } finally {
        for (const user of Object.values(seeded.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

function planner(page: Page): Locator {
    return page.getByTestId('dungeon-planner');
}

/** The group chip of a claimed character (uuid key) or an unclaimed member (`m<id>`). */
function chip(page: Page, key: string): Locator {
    return planner(page).getByTestId(`planner-chip-${key.toLowerCase()}`);
}

/** The claimed A, B and the first unclaimed M of the seed, as chip keys in plan order. */
function planKeys(s: Seeded): [string, string, string] {
    const { gm, officer } = s.dungeonPlan.characters;
    const unclaimed = must(s.dungeonPlan.unlinkedMemberIds[0], 'unlinked member id');
    return [gm.characterId.toLowerCase(), officer.characterId.toLowerCase(), `m${unclaimed}`];
}

async function openPlanner(page: Page, path: string): Promise<void> {
    await page.goto(path);
    await expect(planner(page).getByRole('heading', { name: 'Dungeon planner' })).toBeVisible({ timeout: 20_000 });
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Desktop: the "Dungeons" list button; below 1024px: the native "Dungeon" select. */
async function pickDungeon(page: Page, testInfo: TestInfo, plan: DungeonPlanSeed): Promise<void> {
    if (isDesktop(testInfo)) {
        const row = planner(page).getByRole('list', { name: 'Dungeons' })
            .getByRole('button', { name: new RegExp(`^${escapeRegExp(plan.instanceName)}`) });
        await row.click();
        await expect(row, `"${plan.instanceName}" is the picked dungeon`).toHaveAttribute('aria-pressed', 'true');
        return;
    }
    await planner(page).getByRole('combobox', { name: 'Dungeon', exact: true }).selectOption(String(plan.instanceId));
}

async function expectDungeonPicked(page: Page, testInfo: TestInfo, plan: DungeonPlanSeed): Promise<void> {
    if (isDesktop(testInfo)) {
        const row = planner(page).getByRole('list', { name: 'Dungeons' })
            .getByRole('button', { name: new RegExp(`^${escapeRegExp(plan.instanceName)}`) });
        await expect(row, 'the link restores the picked dungeon').toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
        return;
    }
    await expect(planner(page).getByRole('combobox', { name: 'Dungeon', exact: true }), 'the link restores the picked dungeon')
        .toHaveValue(String(plan.instanceId), { timeout: 15_000 });
}

async function addCharacter(page: Page, name: string): Promise<void> {
    await planner(page).getByRole('button', { name: /^\+ Add character \(\d+ left\)$/ }).click();
    await page.getByRole('combobox', { name: 'Add a character from the roster' }).fill(name);
    await page.getByRole('option').filter({ hasText: name }).first().click();
}

function params(href: string | null, label: string): URLSearchParams {
    return new URL(must(href, label), 'http://x').searchParams;
}

test.describe('Dungeon planner tab on WoW: Forever guild hubs (ROK-2216)', () => {
    test('P1: a member opens #dungeon-planner on the active tab, after Raids', async ({ page }, testInfo) => {
        await withPlanGuild(testInfo, async (s) => {
            await signInOnboardedMember(page, s.users.member.userId);
            await openPlanner(page, `/hubs/${s.guildId}#${TAB_ID}`);
            await expectActiveHubTab(page, testInfo, 'Dungeon planner', TAB_ID);
            const order = await tabOrder(page);
            expect(order, 'the member sees the Raids tab').toContain('raids');
            expect(order.indexOf(TAB_ID), `Dungeon planner sits after Raids in ${JSON.stringify(order)}`)
                .toBeGreaterThan(order.indexOf('raids'));
        });
    });

    test('P2: a non-member viewer (staff) sees the tab and the claimed characters\' quest chips', async ({ page }, testInfo) => {
        await withPlanGuild(testInfo, async (s) => {
            const plan = s.dungeonPlan;
            await openPlanner(page, plan.planPath);
            const firstQuest = planner(page).getByTestId(`planner-quest-${must(plan.shownQuestIds[0], 'shown quest')}`);
            await expect(firstQuest, 'a usable quest of the dungeon renders').toBeVisible({ timeout: 20_000 });
            const chips = firstQuest.getByTestId('planner-quest-chip');
            await expect(chips, 'one chip per picked claimed character (the unclaimed pick has none)').toHaveCount(2);
            await expect(chips.filter({ hasText: rosterName(s, 'Aldren') }), 'the gm character\'s chip').toHaveCount(1);
            await expect(chips.filter({ hasText: rosterName(s, 'Brisa') }), 'the officer character\'s chip').toHaveCount(1);
        });
    });

    test('P3: a picked dungeon + 2 claimed + 1 unclaimed survive opening the copied link', async ({ page }, testInfo) => {
        await withPlanGuild(testInfo, async (s) => {
            const plan = s.dungeonPlan;
            const [a, b, m] = planKeys(s);
            await signInOnboardedMember(page, s.users.member.userId);
            await openPlanner(page, `/hubs/${s.guildId}#${TAB_ID}`);
            await pickDungeon(page, testInfo, plan);
            for (const base of ['Aldren', 'Brisa', 'Corvin'] as const) await addCharacter(page, rosterName(s, base));
            for (const key of [a, b, m]) await expect(chip(page, key), `chip ${key} is picked`).toBeVisible();
            await expect.poll(() => new URL(page.url()).searchParams.get('c'), { message: 'the URL carries the picks in order' })
                .toBe(`${a},${b},${m}`);
            const copied = page.url();
            expect(new URL(copied).searchParams.get('d'), 'the URL carries the dungeon').toBe(String(plan.instanceId));
            expect(new URL(copied).hash, 'the URL opens the planner tab').toBe(`#${TAB_ID}`);

            await openPlanner(page, copied);
            await expectDungeonPicked(page, testInfo, plan);
            await expect(planner(page).getByTestId('planner-group').getByTestId(/^planner-chip-/), 'all 3 picks are restored')
                .toHaveCount(3);
            for (const key of [a, b]) await expect(chip(page, key), `claimed chip ${key} is restored`).not.toContainText('no quest data');
            await expect(chip(page, m), 'the unclaimed pick is restored, greyed "no quest data"').toContainText('no quest data');
        });
    });

    test('P4: the Create event links carry the dungeon, and the invite link the 2 claimed characters', async ({ page }, testInfo) => {
        await withPlanGuild(testInfo, async (s) => {
            const plan = s.dungeonPlan;
            const ids = [plan.characters.gm.characterId, plan.characters.officer.characterId];
            await signInOnboardedMember(page, s.users.member.userId);
            await openPlanner(page, plan.planPath);
            const invite = page.getByRole('link', { name: 'Create event & invite these 2' });
            await expect(invite, 'the invite count is the 2 claimed picks (the unclaimed one is excluded)').toBeVisible({ timeout: 20_000 });
            const inviteQs = params(await invite.getAttribute('href'), 'invite href');
            expect(inviteQs.get('inviteCharacterIds')?.split(',').sort(), 'invite link carries both claimed ids').toEqual([...ids].sort());
            expect(inviteQs.get('contentInstanceIds'), 'invite link carries the dungeon').toBe(String(plan.instanceId));
            expect(inviteQs.get('guildId'), 'invite link carries the guild').toBe(String(s.guildId));

            const plainQs = params(await page.getByRole('link', { name: 'Create event ▸' }).getAttribute('href'), 'plain href');
            expect(plainQs.get('contentInstanceIds'), 'plain link carries the dungeon').toBe(String(plan.instanceId));
            expect(plainQs.get('gameId'), 'plain link carries the game').toBe(String(s.gameId));
            expect(plainQs.has('inviteCharacterIds'), 'plain link invites nobody').toBe(false);

            await invite.click();
            await expect(page).toHaveURL(/\/events\/new\?/);
            await expect(page.getByTestId('invite-preview-line'), 'the Create Event form names the 2 planned characters')
                .toContainText(`Will invite: ${rosterName(s, 'Aldren')}, ${rosterName(s, 'Brisa')}`, { timeout: 15_000 });
        });
    });

    test('P5: the Alliance guild\'s Horde-only quest is hidden and the note says so', async ({ page }, testInfo) => {
        await withPlanGuild(testInfo, async (s) => {
            const plan = s.dungeonPlan;
            await signInOnboardedMember(page, s.users.member.userId);
            await openPlanner(page, plan.planPath);
            const shown = planner(page).getByTestId(`planner-quest-${must(plan.shownQuestIds[0], 'shown quest')}`);
            await expect(shown, 'the plan has loaded: an Alliance-usable quest renders').toBeVisible({ timeout: 20_000 });
            await expect(planner(page).getByTestId(`planner-quest-${plan.hiddenQuestId}`), `Horde-only quest ${plan.hiddenQuestId} is absent`)
                .toHaveCount(0);
            await expect(planner(page).getByTestId('planner-faction-note'), 'the guild-worded hidden-count note')
                .toHaveText(/^\d+ Horde quests? hidden — this is an Alliance guild\.$/);
        });
    });
});
