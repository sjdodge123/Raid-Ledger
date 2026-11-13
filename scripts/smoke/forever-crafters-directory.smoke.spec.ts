/**
 * ROK-1790 — the WoW: Forever guild hub's Crafters tab (`#crafters`, operator
 * ruling 2026-11-12: its own tab, not a Resources section). Every project.
 *
 * Fixture: `POST /admin/test/wow/seed-guild` per test with a per-project,
 * per-worker, per-run name and a random `rosterSuffix`, `armoryProfessions`
 * (one blob — Alchemy 300, Enchanting 265, Cooking 225 — on every linked
 * character: gm, officer, member) and `withArmorySnapshots` (unclaimed roster
 * rows with Armory professions). The seeded users are deleted in `finally`.
 *
 * - A `member` opens `#crafters` directly and from the Overview Guild
 *   professions widget's "See all crafters" link; sees one card per
 *   profession; a character-name search narrows a card to that crafter; a
 *   Profession filter chip narrows to that card. Filters sit behind the
 *   shared Filters entry: the toolbar funnel + inline panel on desktop
 *   (≥1024px), the Filters FAB + BottomSheet below (phone, tablet).
 * - An `outsider` (no character) gets no Crafters tab.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { expectActiveHubTab, tabOrder } from './hub-tabs';
import { isDesktop } from './helpers';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

interface Insights {
    professions?: { name: string; members: { name: string }[] }[];
}

const prof = (id: number, name: string, skillLevel: number) => ({
    id, name, slug: name.toLowerCase(), skillLevel, maxSkillLevel: 300, tiers: [],
});

/** One blob, written to every linked character by the fixture. */
const SEED_PROFESSIONS = {
    primary: [prof(171, 'Alchemy', 300), prof(333, 'Enchanting', 265)],
    secondary: [prof(185, 'Cooking', 225)],
    syncedAt: new Date().toISOString(),
};

function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[forever-crafters-directory] missing ${label}`);
    return value;
}

function guildName(testInfo: TestInfo): string {
    return `Crafters ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

/** Six random letters: this seed's roster names are its own. */
function rosterSuffix(): string {
    return Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
        gameSlug: 'world-of-warcraft-forever',
        rosterSuffix: rosterSuffix(),
        armoryProfessions: SEED_PROFESSIONS,
        withArmorySnapshots: true,
    })) as Partial<SeededGuild> | null;
    if (typeof body?.guildId !== 'number' || !body.users) {
        throw new Error(`[forever-crafters-directory] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

/** Seed, run `body`, always delete the seeded users. */
async function withGuild(testInfo: TestInfo, body: (guild: SeededGuild) => Promise<void>): Promise<void> {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        await body(guild);
    } finally {
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

/** Poll roster insights as the member until the seeded Alchemy crafters land; returns their names. */
async function alchemists(jwt: string, guildId: number): Promise<string[]> {
    const names = await pollForCondition(
        async () => {
            const data = (await apiGet(jwt, `/plugins/wow/guilds/${guildId}/roster-insights`)) as Insights | null;
            const members = data?.professions?.find((p) => p.name === 'Alchemy')?.members ?? [];
            return members.length >= 2 ? members.map((m) => m.name) : null;
        },
        { timeoutMs: 15_000, description: `roster-insights for guild ${guildId} lists two Alchemy crafters` },
    );
    return must(names, 'Alchemy crafters');
}

/** The directory's card grid. */
function cards(page: Page): Locator {
    return page.getByRole('list', { name: 'Crafters by profession' });
}

async function expectDirectory(page: Page, testInfo: TestInfo): Promise<void> {
    await expect(page.getByRole('heading', { name: 'Crafters', level: 2 })).toBeVisible({ timeout: 20_000 });
    await expectActiveHubTab(page, testInfo, 'Crafters', 'crafters');
    for (const name of ['Alchemy', 'Enchanting', 'Cooking']) {
        await expect(cards(page).getByRole('heading', { name, level: 3 }), `a ${name} card`).toBeVisible();
    }
}

/** Open the Filters entry: the inline panel on desktop, the FAB's BottomSheet below 1024px. */
async function openFilters(page: Page, testInfo: TestInfo): Promise<void> {
    const fab = page.getByTestId('filter-fab');
    if (isDesktop(testInfo)) {
        await expect(fab, 'desktop uses the toolbar funnel, no FAB').toHaveCount(0);
    } else {
        await expect(fab, 'below 1024px the Filters FAB opens the filters').toBeVisible();
    }
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    if (!isDesktop(testInfo)) await expect(page.getByRole('dialog')).toBeVisible();
}

test('member: #crafters shows profession cards; search and the Profession filter narrow them', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        const jwt = await signInOnboardedMember(page, guild.users.member.userId);
        const [target, other] = await alchemists(jwt, guild.guildId);
        const name = must(target, 'first alchemist');
        const otherName = must(other, 'second alchemist');
        await page.goto(`/hubs/${guild.guildId}#crafters`);
        await expectDirectory(page, testInfo);

        const alchemy = page.getByRole('list', { name: 'Alchemy crafters' });
        await expect(alchemy.getByText(otherName, { exact: true }), 'before search, every alchemist is listed').toBeVisible();
        await page.getByRole('searchbox', { name: 'Search professions or crafters' }).fill(name);
        await expect(alchemy.getByText(name, { exact: true }), 'the searched crafter stays').toBeVisible();
        await expect(alchemy.getByText(otherName, { exact: true }), 'a name search narrows the card').toHaveCount(0);
        await page.getByRole('button', { name: 'Clear search' }).click();
        await expect(alchemy.getByText(otherName, { exact: true }), 'clearing the search restores the card').toBeVisible();

        await openFilters(page, testInfo);
        await page.getByRole('button', { name: 'Enchanting', exact: true }).click();
        if (!isDesktop(testInfo)) await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
        await expect(cards(page).getByRole('heading', { name: 'Enchanting', level: 3 })).toBeVisible();
        await expect(cards(page).getByRole('heading', { name: 'Alchemy', level: 3 }), 'the filter drops other cards').toHaveCount(0);
        await expect(cards(page).getByRole('heading', { name: 'Cooking', level: 3 })).toHaveCount(0);
    });
});

test('member: "See all crafters" on the Guild professions widget opens the Crafters tab', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        const jwt = await signInOnboardedMember(page, guild.users.member.userId);
        await alchemists(jwt, guild.guildId);
        await page.goto(`/hubs/${guild.guildId}`);
        const widget = page.getByRole('region', { name: 'Guild professions', exact: true });
        await expect(widget, 'a member sees the Guild professions card').toBeVisible({ timeout: 20_000 });
        await widget.getByRole('link', { name: 'See all crafters' }).click();
        await expect(page).toHaveURL(/#crafters$/);
        await expectDirectory(page, testInfo);
    });
});

test('outsider: a non-member gets no Crafters tab', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await signInOnboardedMember(page, guild.users.outsider.userId);
        await page.goto(`/hubs/${guild.guildId}#crafters`);
        await expect(page.getByTestId('wow-join-gate'), 'a non-member sees the join gate').toBeVisible({ timeout: 20_000 });
        expect(await tabOrder(page), 'no #crafters tab in the row or the More menu').not.toContain('crafters');
        await expect(page.getByRole('heading', { name: 'Crafters', level: 2 }), 'no directory for a non-member').toHaveCount(0);
    });
});
