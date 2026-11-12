/**
 * ROK-2186: quest reward rows render through the boss-loot row (ItemCompareRow)
 * — the "Equipped:" block and the loot-vs-equipped compare popup.
 *
 * Seeds deterministically through the API (no Blizzard keys, no Wowhead fetch):
 *  - the admin's own Classic Era character (game resolved by its stable slug),
 *  - a Classic Era event on Blackrock Depths — the boot seed
 *    (dungeon-quest-data.json) lists "The Love Potion" there: no prerequisite,
 *    no class/race restriction, a choice of Manacle Cuffs (WRIST) or
 *    Nagmara's Whipping Belt (WAIST),
 *  - the admin's signup with that character (Quest Prep compares against it),
 *  - `POST /admin/test/wow/seed-item-tooltips` (DEMO_MODE fixture) with only
 *    `equipment`: a WAIST item on the character, the WRIST slot left empty.
 * Runs in every project; the popup layout branches on viewport width
 * (≤768px = BottomSheet, wider = Modal + aligned table).
 */
import { test, expect } from './base';
import type { Locator, Page } from '@playwright/test';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';

const GAME_SLUG = 'world-of-warcraft-classic';
const VARIANT = 'classic_era';
const INSTANCE = {
    id: 228, name: 'Blackrock Depths', shortName: 'BRD', expansion: 'Classic',
    minimumLevel: 52, maximumLevel: 60, maxPlayers: 5, category: 'dungeon',
};
const QUEST_NAME = 'The Love Potion';
const REWARD = { waist: "Nagmara's Whipping Belt", wrist: 'Manacle Cuffs' } as const;
const EQUIPPED_WAIST = 'Smoke Test Girdle';
const SEED_GEAR = [{ slot: 'WAIST', itemId: 913394, name: EQUIPPED_WAIST, quality: 'RARE', itemLevel: 10 }];

let token = '';
let gameId: number | null = null;
let eventId: number | null = null;
let characterId: string | null = null;

async function seedAll(): Promise<void> {
    const name = `Qr${Date.now().toString(36)}`;
    const char = (await apiPost(token, '/users/me/characters', { gameId, name, class: 'Warrior', role: 'tank' })) as { id?: string } | null;
    characterId = char?.id ?? null;
    if (!characterId) throw new Error('character create returned no id');
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 90_000_000).toISOString();
    const event = (await apiPost(token, '/events', {
        title: `ROK-2186 quest rewards ${name}`, gameId, startTime: start, endTime: end, maxAttendees: 5, contentInstances: [INSTANCE],
    })) as { id?: number } | null;
    eventId = event?.id ?? null;
    if (!eventId) throw new Error('event create returned no id');
    await apiPost(token, `/events/${eventId}/signup`, { characterId });
    // The create API leaves gameVariant null, and Armory gear is only decorated for vanilla-era variants.
    const seeded = (await apiPost(token, '/admin/test/wow/seed-item-tooltips', { characterId, equipment: SEED_GEAR, gameVariant: VARIANT })) as { characterId?: string } | null;
    if (!seeded) throw new Error('seed-item-tooltips returned nothing (DEMO_MODE off?)');
}

function isPhoneWidth(page: Page): boolean {
    return (page.viewportSize()?.width ?? 1280) <= 768;
}

function questCard(page: Page): Locator {
    return page.locator('.quest-card').filter({ has: page.locator('.quest-card__name', { hasText: QUEST_NAME }) });
}

function rewardRow(page: Page, rewardName: string): Locator {
    return questCard(page).getByTestId('item-compare-row').filter({ has: page.getByRole('link', { name: rewardName, exact: true }) });
}

async function openQuest(page: Page): Promise<void> {
    await page.goto(`/events/${eventId}`);
    const header = questCard(page).locator('.quest-card__header');
    await expect(header, 'Quest Prep lists the seeded BRD quest').toBeVisible({ timeout: 20_000 });
    await header.click();
    await expect(rewardRow(page, REWARD.waist), 'the expanded quest lists its belt reward').toBeVisible({ timeout: 15_000 });
}

/** Exactly one dialog on the page, holding both the reward and the equipped item. */
async function expectOneCompareDialog(page: Page, rewardName: string, equippedName: string): Promise<void> {
    await expect(page.locator('[role="dialog"]'), 'one dialog, never a second overlay').toHaveCount(1);
    const body = page.getByTestId('item-compare-dialog');
    await expect(body, 'phone stacks, wider viewports use the aligned compare table').toHaveAttribute('data-layout', isPhoneWidth(page) ? 'stacked' : 'table');
    await expect(body.getByTestId('compare-loot-column'), 'the reward is in the popup').toContainText(rewardName);
    await expect(body.getByTestId('compare-equipped-column'), 'the equipped item is in the popup').toContainText(equippedName);
}

async function closeVia(page: Page, how: 'x' | 'escape'): Promise<void> {
    if (how === 'escape') await page.keyboard.press('Escape');
    else await page.locator('[role="dialog"]').getByRole('button', { name: isPhoneWidth(page) ? 'Close' : 'Close modal', exact: true }).click();
    await expect(page.locator('[role="dialog"]'), `the popup closes via ${how}`).toHaveCount(0);
}

test.describe('ROK-2186: quest reward rows share the boss-loot compare row', () => {
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

    test('every choice reward renders the shared row with its equipped slot', async ({ page }) => {
        await openQuest(page);
        await expect(questCard(page).getByTestId('item-compare-row'), 'both choice rewards use the shared row').toHaveCount(2);
        const waist = rewardRow(page, REWARD.waist).locator('.item-comparison');
        await expect(waist, 'the belt compares against the equipped waist item').toContainText(EQUIPPED_WAIST);
        await expect(rewardRow(page, REWARD.wrist).locator('.item-comparison'), 'nothing on the wrist: "Empty slot"').toContainText('Empty slot');
        await expect(questCard(page), 'no missing field leaks as text').not.toContainText('undefined');
    });

    test('tapping the reward and tapping the equipped item each open ONE compare popup', async ({ page }) => {
        await openQuest(page);
        const row = rewardRow(page, REWARD.waist);
        await row.getByRole('link', { name: REWARD.waist, exact: true }).click();
        await expectOneCompareDialog(page, REWARD.waist, EQUIPPED_WAIST);
        await closeVia(page, 'x');

        await row.locator('.item-comparison').getByRole('link', { name: EQUIPPED_WAIST, exact: true }).click();
        await expectOneCompareDialog(page, REWARD.waist, EQUIPPED_WAIST);
        await closeVia(page, 'escape');
    });
});
