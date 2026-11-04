/**
 * ROK-2071 — the Core "Hub" field on the event form tags an event of a
 * non-WoW game to a community hub. The old picker lived in the WoW plugin,
 * so only WoW guilds were ever taggable.
 *
 * Seeds this caller's tagged community-hubs fixture
 * (`POST /admin/test/community-hubs/seed {gameId}`, see `hub-seed.ts`) on a
 * configured non-WoW game, creates an UNTAGGED event on that game through the
 * API, then as the admin (staff see every live hub of the game) opens the
 * EDIT form, picks the seeded "Seed Crew" hub in the Hub field and saves.
 * The tag is confirmed by polling `GET /events/:id` — the first render is
 * never trusted (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInAsAdmin } from './browser-session';

const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };
const GAME_OFFSET = 12;

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[event-hub-tag] missing ${label}`);
    return value;
}

/** A configured game that is not WoW, offset per project so projects never share a game. */
async function nonWowGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => g as { id?: unknown; slug?: unknown })
        .filter((g) => typeof g.slug === 'string' && !/warcraft|wow/i.test(g.slug))
        .map((g) => g.id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[event-hub-tag] GET /games/configured returned no non-WoW game');
    const slot = PROJECT_SLOT[testInfo.project.name] ?? 0;
    return must(ids[(GAME_OFFSET + slot) % ids.length], 'non-WoW game');
}

async function seedCrew(admin: string, gameId: number, testInfo: TestInfo): Promise<number> {
    const body = (await seedCommunityHubs(admin, testInfo, 'event-hub-tag', { gameId })) as { hubIds?: { crew?: unknown } } | null;
    const crew = body?.hubIds?.crew;
    if (typeof crew !== 'number') throw new Error(`[event-hub-tag] seed: ${JSON.stringify(body)}`);
    return crew;
}

async function createUntaggedEvent(admin: string, gameId: number, title: string): Promise<number> {
    const start = new Date(Date.now() + 3 * 86_400_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const event = (await apiPost(admin, '/events', {
        title, gameId, startTime: start.toISOString(), endTime: end.toISOString(), maxAttendees: 10,
    })) as { id?: unknown } | null;
    if (typeof event?.id !== 'number') throw new Error(`[event-hub-tag] POST /events: ${JSON.stringify(event)}`);
    return event.id;
}

test('edit form: a non-WoW event is tagged to a community hub through the Core Hub field', async ({ page, world }, testInfo) => {
    const admin = await getAdminToken();
    const gameId = await nonWowGameId(admin, testInfo);
    const crewId = await seedCrew(admin, gameId, testInfo);
    const eventId = await createUntaggedEvent(admin, gameId, world.uid('hub-tag'));
    try {
        await signInAsAdmin(page.context());
        await page.goto(`/events/${eventId}/edit`);
        await expect(page.getByRole('heading', { name: 'Edit Event' })).toBeVisible({ timeout: 15_000 });

        const hubField = page.getByTestId('event-hub-field');
        await expect(hubField, 'staff see the Hub field for a game with a community hub — no WoW plugin needed').toBeVisible({ timeout: 15_000 });
        const select = hubField.getByRole('combobox');
        await expect(select, 'the event starts untagged').toHaveValue('');
        await select.selectOption(String(crewId));
        await expect(select).toHaveValue(String(crewId));

        await page.getByRole('button', { name: 'Save Changes' }).click();
        await page.waitForURL(new RegExp(`/events/${eventId}(?:[?#].*)?$`), { timeout: 15_000 });
        await expect.poll(async () => ((await apiGet(admin, `/events/${eventId}`)) as { guildId?: number | null } | null)?.guildId, {
            message: 'the saved event must carry the community hub as guild_id',
            timeout: 15_000,
        }).toBe(crewId);
    } finally {
        await apiDelete(admin, `/events/${eventId}`).catch(() => undefined);
    }
});
