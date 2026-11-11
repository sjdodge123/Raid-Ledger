/**
 * ROK-2176: Boss & Loot row stat chips and the loot-vs-equipped compare popup.
 *
 * Seeds deterministically through the API (no Blizzard keys, no Wowhead fetch):
 *  - the admin's own Classic Era character (game resolved by its stable slug),
 *  - a Classic Era event on Blackrock Depths (boot-seeded boss data, Bael'Gar),
 *  - the admin's signup with that character (the panel compares against it),
 *  - `POST /admin/test/wow/seed-item-tooltips` (DEMO_MODE fixture): stored
 *    tooltips for three of Bael'Gar's drops, a found-but-statless row for the
 *    fourth, and Armory-shaped gear on the character.
 * Runs in every project; the row/dialog layout branches on viewport width
 * (≤768px = phone chips + BottomSheet, wider = every chip + Modal).
 */
import { test, expect } from './base';
import type { Locator, Page } from '@playwright/test';
import { apiDelete, apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';

const GAME_SLUG = 'world-of-warcraft-classic';
const VARIANT = 'classic_era';
const INSTANCE = {
    id: 228, name: 'Blackrock Depths', shortName: 'BRD', expansion: 'Classic',
    minimumLevel: 52, maximumLevel: 60, maxPlayers: 5, category: 'dungeon',
};
const BOSS_NAME = "Bael'Gar";
const LOOT = {
    legs: { id: 11802, name: 'Lavacrest Leggings' },
    twoHand: { id: 11803, name: 'Force of Magma' },
    finger: { id: 22257, name: 'Bloodclot Band' },
    noStats: { id: 11807, name: 'Sash of the Burning Heart' },
} as const;
const EQUIPPED_LEGS = 'Smoke Test Trousers';
/** Legs deltas: 5 stats + armor, all non-zero (see the tooltips below). */
const LEGS_DELTA_COUNT = 6;
const PHONE_CHIP_COUNT = 3;

type Stat = [key: string, name: string, value: number];

function tooltip(slotLabel: string, stats: Stat[], extra: Record<string, unknown> = {}) {
    return {
        env: 4, slotLabel, subclass: null, binding: 'Binds when picked up', unique: false,
        requiredLevel: 50, armor: null, weapon: null, effects: [], setName: null, randomEnchant: false,
        stats: stats.map(([key, name, value]) => ({ key, name, value })),
        ...extra,
    };
}

const SEED_ITEMS = [
    { itemId: LOOT.legs.id, tooltip: tooltip('Legs', [['STAMINA', 'Stamina', 10], ['INTELLECT', 'Intellect', 8], ['SPIRIT', 'Spirit', 6], ['STRENGTH', 'Strength', 5], ['AGILITY', 'Agility', 4]], { armor: 60, subclass: 'Cloth' }) },
    { itemId: LOOT.twoHand.id, tooltip: tooltip('Two-Hand', [['STRENGTH', 'Strength', 12], ['STAMINA', 'Stamina', 8]], { subclass: 'Mace', weapon: { damageMin: 60, damageMax: 90, attackSpeed: 3.4, dps: 22.1 } }) },
    { itemId: LOOT.finger.id, tooltip: tooltip('Finger', [['STAMINA', 'Stamina', 6], ['SPIRIT', 'Spirit', 4]]) },
    // Found, but no stats: the row carries `tooltip: null` → "Stats not synced".
    { itemId: LOOT.noStats.id, tooltip: null },
    { itemId: 913389, tooltip: tooltip('Legs', [['STAMINA', 'Stamina', 4], ['INTELLECT', 'Intellect', 2]], { armor: 50, subclass: 'Cloth' }) },
    { itemId: 913392, tooltip: tooltip('Finger', [['STAMINA', 'Stamina', 3]]) },
    { itemId: 918522, tooltip: tooltip('Finger', [['STAMINA', 'Stamina', 5]]) },
    { itemId: 913393, tooltip: tooltip('Main Hand', [['STRENGTH', 'Strength', 4]], { weapon: { damageMin: 30, damageMax: 50, attackSpeed: 2.6, dps: 15.4 } }) },
    { itemId: 918523, tooltip: null },
];

const SEED_GEAR = [
    { slot: 'LEGS', itemId: 913389, name: EQUIPPED_LEGS, quality: 'RARE', itemLevel: 20 },
    { slot: 'FINGER_1', itemId: 913392, name: 'Smoke Test Seal', quality: 'UNCOMMON', itemLevel: 20 },
    { slot: 'FINGER_2', itemId: 918522, name: 'Smoke Test Band', quality: 'RARE', itemLevel: 25 },
    { slot: 'MAIN_HAND', itemId: 913393, name: 'Smoke Test Mace', quality: 'RARE', itemLevel: 22 },
    { slot: 'OFF_HAND', itemId: 918523, name: 'Smoke Test Orb', quality: 'RARE', itemLevel: 22 },
];

interface LootRow { itemId: number; tooltip?: unknown }

let token = '';
let gameId: number | null = null;
let eventId: number | null = null;
let characterId: string | null = null;

async function findBossId(): Promise<number> {
    const bosses = (await apiGet(token, `/plugins/wow-classic/instances/${INSTANCE.id}/bosses?variant=${VARIANT}`)) as { id: number; name: string }[] | null;
    const boss = bosses?.find((b) => b.name === BOSS_NAME);
    if (!boss) throw new Error(`boot seed has no ${BOSS_NAME} in instance ${INSTANCE.id} for ${VARIANT}`);
    return boss.id;
}

/** The seed clears the loot cache; wait until the loot API serves the tooltip before any page fetch. */
async function waitForSeededLoot(): Promise<void> {
    const bossId = await findBossId();
    await pollForCondition(async () => {
        const loot = (await apiGet(token, `/plugins/wow-classic/bosses/${bossId}/loot?variant=${VARIANT}`)) as LootRow[] | null;
        return loot?.find((l) => l.itemId === LOOT.legs.id && l.tooltip) ?? null;
    }, { description: `${LOOT.legs.name} loot row carries the seeded tooltip`, timeoutMs: 20_000 });
}

async function seedAll(): Promise<void> {
    const name = `Bl${Date.now().toString(36)}`;
    const char = (await apiPost(token, '/users/me/characters', { gameId, name, class: 'Priest', role: 'healer' })) as { id?: string } | null;
    characterId = char?.id ?? null;
    if (!characterId) throw new Error('character create returned no id');
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 90_000_000).toISOString();
    const event = (await apiPost(token, '/events', {
        title: `ROK-2176 compare ${name}`, gameId, startTime: start, endTime: end, maxAttendees: 5, contentInstances: [INSTANCE],
    })) as { id?: number } | null;
    eventId = event?.id ?? null;
    if (!eventId) throw new Error('event create returned no id');
    await apiPost(token, `/events/${eventId}/signup`, { characterId });
    const seeded = (await apiPost(token, '/admin/test/wow/seed-item-tooltips', { items: SEED_ITEMS, characterId, equipment: SEED_GEAR })) as { itemIds?: number[] } | null;
    if (!seeded?.itemIds?.length) throw new Error('seed-item-tooltips returned no itemIds (DEMO_MODE off?)');
    await waitForSeededLoot();
}

function isPhoneWidth(page: Page): boolean {
    return (page.viewportSize()?.width ?? 1280) <= 768;
}

function lootRow(page: Page, lootName: string): Locator {
    return page.locator('.quest-reward-item-wrapper').filter({ has: page.getByRole('link', { name: lootName, exact: true }) });
}

async function openBossLoot(page: Page): Promise<void> {
    await page.goto(`/events/${eventId}`);
    const header = page.locator('.boss-row__header', { hasText: BOSS_NAME });
    await expect(header, 'Boss & Loot lists the seeded instance boss').toBeVisible({ timeout: 20_000 });
    await header.click();
    await expect(lootRow(page, LOOT.legs.name), 'the expanded boss lists the Legs drop').toBeVisible({ timeout: 15_000 });
}

/** Exactly one dialog on the page, holding both the drop and the equipped item. */
async function expectOneCompareDialog(page: Page, lootName: string, equippedName: string): Promise<Locator> {
    await expect(page.locator('[role="dialog"]'), 'one dialog, never a second overlay').toHaveCount(1);
    const body = page.getByTestId('item-compare-dialog');
    await expect(body, 'phone stacks, wider viewports use two columns').toHaveAttribute('data-layout', isPhoneWidth(page) ? 'stacked' : 'columns');
    await expect(body.getByTestId('compare-loot-column'), 'the drop is in the popup').toContainText(lootName);
    await expect(body.getByTestId('compare-equipped-column'), 'the equipped item is in the popup').toContainText(equippedName);
    return page.locator('[role="dialog"]');
}

async function closeVia(page: Page, how: 'x' | 'escape'): Promise<void> {
    if (how === 'escape') await page.keyboard.press('Escape');
    else await page.locator('[role="dialog"]').getByRole('button', { name: isPhoneWidth(page) ? 'Close' : 'Close modal', exact: true }).click();
    await expect(page.locator('[role="dialog"]'), `the popup closes via ${how}`).toHaveCount(0);
}

test.describe('ROK-2176: Boss & Loot compare popup', () => {
    test.beforeAll(async () => {
        token = await getAdminToken();
        const game = (await apiGet(token, `/games/slug/${GAME_SLUG}`)) as { id?: number } | null;
        gameId = game?.id ?? null;
        if (gameId !== null) await seedAll();
    });

    test.afterAll(async () => {
        if (eventId) await apiDelete(token, `/events/${eventId}`);
        if (characterId) await apiDelete(token, `/users/me/characters/${characterId}`);
    });

    test.beforeEach(() => {
        test.skip(gameId === null, `"${GAME_SLUG}" is not in this env (boot seed seed-games.data.ts did not run)`);
    });

    test('the row shows every stat chip on wide viewports, 3 + "+N more" on a phone', async ({ page }) => {
        await openBossLoot(page);
        const row = lootRow(page, LOOT.legs.name);
        const chips = row.getByTestId('stat-delta-chips').locator('.stat-delta-chip:not(.stat-delta-chip--more)');
        const more = row.getByRole('button', { name: /^\+\d+ more stat changes/ });
        if (isPhoneWidth(page)) {
            await expect(chips, 'a phone row shows the 3 largest stat changes').toHaveCount(PHONE_CHIP_COUNT);
            await expect(more, 'a phone row ends with "+N more"').toBeVisible();
            await more.click();
            await expectOneCompareDialog(page, LOOT.legs.name, EQUIPPED_LEGS);
            await closeVia(page, 'x');
        } else {
            await expect(chips, 'a wide row shows every non-zero stat change').toHaveCount(LEGS_DELTA_COUNT);
            await expect(more, 'a wide row has no "+N more"').toHaveCount(0);
        }
        await expect(row.locator('[data-testid="stat-delta-chips"] .stat-delta-chip[data-tone="up"]').first(), 'gains are toned up').toBeVisible();
    });

    test('tapping the drop and tapping the equipped item each open ONE popup with both items and line deltas', async ({ page }) => {
        await openBossLoot(page);
        const row = lootRow(page, LOOT.legs.name);

        await row.getByRole('link', { name: LOOT.legs.name, exact: true }).click();
        const dialog = await expectOneCompareDialog(page, LOOT.legs.name, EQUIPPED_LEGS);
        // Desktop puts the deltas in the table's Δ column, phone inside the loot block: count them dialog-wide.
        const lootDeltas = dialog.getByTestId('line-delta');
        await expect.poll(() => lootDeltas.count(), 'a delta beside every stat line plus the iLvl delta').toBeGreaterThanOrEqual(LEGS_DELTA_COUNT + 1);
        await expect(dialog.locator('[data-testid="line-delta"][data-tone="up"]').first(), 'the upgrade lines are toned up').toBeVisible();
        await closeVia(page, 'x');

        await row.locator('.item-comparison').getByRole('link', { name: EQUIPPED_LEGS, exact: true }).click();
        await expectOneCompareDialog(page, LOOT.legs.name, EQUIPPED_LEGS);
        await closeVia(page, 'escape');
    });

    test('a drop without stored stats shows the "stats not synced" note', async ({ page }) => {
        await openBossLoot(page);
        await lootRow(page, LOOT.noStats.name).getByRole('link', { name: LOOT.noStats.name, exact: true }).click();
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog, 'one popup').toHaveCount(1);
        await expect(page.getByTestId('compare-loot-column'), 'the statless drop is in the popup').toContainText(LOOT.noStats.name);
        await expect(dialog.locator('[data-testid="stats-not-synced"][data-side="loot"]'), 'the statless drop says so').toBeVisible();
        await closeVia(page, 'escape');
    });

    test('"View on Wowhead" opens a new page and leaves exactly one popup with no Wowhead overlay', async ({ page, context }) => {
        await openBossLoot(page);
        // Keyboard-open so no hover over a data-wowhead link can leave a row tooltip behind.
        const link = lootRow(page, LOOT.legs.name).getByRole('link', { name: LOOT.legs.name, exact: true });
        await link.focus();
        await page.keyboard.press('Enter');
        const dialog = await expectOneCompareDialog(page, LOOT.legs.name, EQUIPPED_LEGS);
        // Phone: "View on Wowhead"; desktop: "Loot on Wowhead" / "Equipped on Wowhead".
        const wowhead = dialog.getByRole('button', { name: /on Wowhead/ }).first();
        await expect(wowhead, 'the Wowhead control is a button, not a tooltip-bound link').toBeVisible();
        const [popup] = await Promise.all([context.waitForEvent('page'), wowhead.click()]);
        await popup.close();
        await expect(page.locator('[role="dialog"]'), 'still exactly one popup after the Wowhead tap').toHaveCount(1);
        await expect(page.locator('.wowhead-tooltip:visible'), 'no Wowhead tooltip overlay appears').toHaveCount(0);
        await closeVia(page, 'escape');
    });
});
