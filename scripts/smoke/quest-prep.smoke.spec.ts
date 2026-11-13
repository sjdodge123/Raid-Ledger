/**
 * WoW Quest Prep panel (ROK-246, to-do lines ROK-2169, location groups ROK-2142)
 * renders on a dungeon event's detail page for a signed-up player.
 *
 * Seeds deterministically through the API (no Blizzard keys, no Wowhead fetch):
 *  - the admin's own Classic Era character (game resolved by its stable slug),
 *  - a Classic Era event on Blackrock Depths — the boot seed
 *    (api/src/plugins/wow-common/dungeon-quest-data.json) lists, among others:
 *      "The Heart of the Mountain": sharable, picked up OUTSIDE, no chain, no
 *        class/race restriction → counted by the "sharable to grab" line,
 *      "The Love Potion": sharable, picked up INSIDE, no restriction,
 *  - the admin's signup with that character (the panel reads it for filtering).
 * Nobody has marked a quest picked up on a brand-new event, so the sharable
 * to-do line must show. Runs in every project (desktop + mobile).
 */
import { test, expect } from './base';
import type { Locator, Page } from '@playwright/test';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';

const GAME_SLUG = 'world-of-warcraft-classic';
const INSTANCE = {
    id: 228, name: 'Blackrock Depths', shortName: 'BRD', expansion: 'Classic',
    minimumLevel: 52, maximumLevel: 60, maxPlayers: 5, category: 'dungeon',
};
const OUTSIDE_QUEST = 'The Heart of the Mountain';
const INSIDE_QUEST = 'The Love Potion';

let token = '';
let gameId: number | null = null;
let eventId: number | null = null;
let characterId: string | null = null;

async function seedAll(): Promise<void> {
    const name = `Qp${Date.now().toString(36)}`;
    const char = (await apiPost(token, '/users/me/characters', { gameId, name, class: 'Warrior', role: 'tank' })) as { id?: string } | null;
    characterId = char?.id ?? null;
    if (!characterId) throw new Error('character create returned no id');
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 90_000_000).toISOString();
    const event = (await apiPost(token, '/events', {
        title: `Quest Prep smoke ${name}`, gameId, startTime: start, endTime: end, maxAttendees: 5, contentInstances: [INSTANCE],
    })) as { id?: number } | null;
    eventId = event?.id ?? null;
    if (!eventId) throw new Error('event create returned no id');
    await apiPost(token, `/events/${eventId}/signup`, { characterId });
}

function panel(page: Page): Locator {
    return page.locator('.quest-prep-panel');
}

function questCard(page: Page, questName: string): Locator {
    return panel(page).locator('.quest-card').filter({ has: page.locator('.quest-card__name', { hasText: questName }) });
}

function questGroup(page: Page, title: string): Locator {
    return panel(page).locator('.quest-group').filter({ has: page.locator('.quest-group__title', { hasText: title }) });
}

async function openPanel(page: Page): Promise<void> {
    await page.goto(`/events/${eventId}`);
    await expect(
        panel(page).getByRole('heading', { level: 2, name: /Quest Prep/ }),
        'the event page hosts the Quest Prep panel for a signed-up BRD player',
    ).toBeVisible({ timeout: 20_000 });
}

test.describe('WoW Quest Prep panel on a dungeon event', () => {
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

    test('lists the seeded quests under their location groups with the to-do line', async ({ page }) => {
        await openPanel(page);
        await expect(panel(page), 'the header counts the usable quests').toContainText(/\d+ quests/);
        await expect(
            panel(page).getByTestId('quest-prep-sharable-line'),
            'nobody has picked up the outside sharable quests on a new event',
        ).toHaveText(/Someone needs to grab \d+ sharable quests?/);

        const before = questGroup(page, 'Get before you go in');
        await expect(before.locator('.quest-card__name', { hasText: OUTSIDE_QUEST }), `"${OUTSIDE_QUEST}" is a get-before-you-go-in quest`).toBeVisible();
        const inside = questGroup(page, 'Picked up inside');
        await expect(inside.locator('.quest-card__name', { hasText: INSIDE_QUEST }), `"${INSIDE_QUEST}" is a picked-up-inside quest`).toBeVisible();
        await expect(panel(page), 'no missing field leaks as text').not.toContainText('undefined');
    });

    test('expanding a quest shows that no one has it yet', async ({ page }) => {
        await openPanel(page);
        const card = questCard(page, OUTSIDE_QUEST);
        await card.locator('.quest-card__header').click();
        await expect(
            card.locator('.quest-coverage__status--needed'),
            'an uncovered quest says nobody has it',
        ).toHaveText('No one has this yet');
    });
});
