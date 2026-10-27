/**
 * ROK-1950 — rename a hub after it is created (desktop, mobile and tablet).
 *
 * Seeds (DEMO_MODE, admin JWT):
 *  - community: `POST /admin/test/community-hubs/seed {gameId}` on a configured
 *    game no other hub spec seeds (index 9 + project slot; community-hubs takes
 *    0–2, hubs-nav 3–5, hub-invite/hub-poll/calendar-hub 6–8). Every re-seed
 *    deletes the hubs a seed user leads, so a renamed "Seed Crew" never
 *    survives into the next run.
 *  - server: `POST /admin/test/pelican/server-hub {slot}` on this worker's slot
 *    (`1 + parallelIndex`, the server-hub.smoke pattern). A re-seed puts the hub
 *    back on its server's name and clears the override, so a run that dies
 *    mid-rename leaves nothing behind; the server test also resets in `finally`.
 *  - WoW guild (ROK-2015): `POST /admin/test/wow/seed-guild {name}` with a
 *    per-project, per-worker, per-run name (the guild-page.smoke pattern); its
 *    `source_name` is that name. `finally` resets the name via the API and
 *    deletes the seeded member users.
 *
 * Every write is confirmed by polling `GET /guilds/:id` before the UI is
 * trusted (memory `feedback_smoke_polling_for_async_writes`). No `sleep()`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPatch, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

interface CommunitySeed {
    gameId: number;
    hubIds: { crew: number; solo: number };
    leaderUserId: number;
    /** `[officer, member-1, member-2, member-3, member-4]`. */
    memberUserIds: number[];
}

interface HubName {
    name: string;
    nameOverridden?: boolean;
    serverName?: string;
    inGameName?: string | null;
}

interface WowSeed {
    guildId: number;
    name: string;
    userIds: number[];
}

const ADMIN_HUBS_ACTIVE = '/admin/settings/general/hubs#active';
const GAME_INDEX_BASE = 9;
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };
const NAME_TAKEN = 'A hub with that name already exists for this game';

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hub-rename] missing ${label}`);
    return value;
}

/** A name no other project or run uses (≤64 chars). */
function uniqueName(testInfo: TestInfo, prefix: string): string {
    return `${prefix} ${testInfo.project.name} ${Date.now().toString(36)}`;
}

async function projectGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[hub-rename] GET /games/configured returned no games');
    const slot = PROJECT_SLOT[testInfo.project.name] ?? 0;
    return must(ids[(GAME_INDEX_BASE + slot) % ids.length], 'project game id');
}

async function seedCommunity(token: string, testInfo: TestInfo): Promise<CommunitySeed> {
    const gameId = await projectGameId(token, testInfo);
    const body = (await apiPost(token, '/admin/test/community-hubs/seed', { gameId })) as Partial<CommunitySeed> | null;
    if (!body?.hubIds || typeof body.leaderUserId !== 'number' || !Array.isArray(body.memberUserIds)) {
        throw new Error(`[hub-rename] community seed: ${JSON.stringify(body)}`);
    }
    return body as CommunitySeed;
}

async function seedServerHub(token: string, testInfo: TestInfo): Promise<number> {
    const slot = 1 + (testInfo.parallelIndex % 15);
    const body = (await apiPost(token, '/admin/test/pelican/server-hub', { slot })) as { guildId?: unknown } | null;
    if (typeof body?.guildId !== 'number') throw new Error(`[hub-rename] server-hub seed: ${JSON.stringify(body)}`);
    return body.guildId;
}

/** A WoW guild named for this project, worker and run (fixture: 3-48 chars). */
async function seedWowGuild(token: string, testInfo: TestInfo): Promise<WowSeed> {
    const name = `Rename ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now().toString(36)}`;
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name })) as {
        guildId?: unknown;
        users?: Record<string, { userId?: unknown }>;
    } | null;
    if (typeof body?.guildId !== 'number') throw new Error(`[hub-rename] seed-guild: ${JSON.stringify(body)}`);
    const userIds = Object.values(body.users ?? {})
        .map((u) => u.userId)
        .filter((id): id is number => typeof id === 'number');
    return { guildId: body.guildId, name, userIds };
}

/** The hub's name, override flag and source name (Pelican's / in-game), as the API sends them. */
async function hubName(token: string, hubId: number): Promise<HubName> {
    const body = (await apiGet(token, `/guilds/${hubId}`)) as {
        guild?: { name?: string; nameOverridden?: boolean; inGameName?: string | null };
        server?: { serverName?: string };
    } | null;
    const name = must(body?.guild?.name, `GET /guilds/${hubId} guild.name`);
    return {
        name,
        ...(body?.guild?.nameOverridden !== undefined ? { nameOverridden: body.guild.nameOverridden } : {}),
        ...(body?.guild?.inGameName !== undefined ? { inGameName: body.guild.inGameName } : {}),
        ...(body?.server?.serverName !== undefined ? { serverName: body.server.serverName } : {}),
    };
}

async function adminGameName(token: string, hubId: number): Promise<string> {
    const list = (await apiGet(token, '/admin/hubs?status=active')) as { items?: Array<{ id: number; gameName: string }> } | null;
    return must(list?.items?.find((h) => h.id === hubId)?.gameName, `hub ${hubId} in GET /admin/hubs?status=active`);
}

/** The Active-tab row for `name` on `gameName` (every seeded game has a "Seed Crew"). */
function adminRow(page: Page, name: string, gameName: string): Locator {
    return page
        .getByRole('listitem')
        .filter({ has: page.getByText(name, { exact: true }) })
        .filter({ has: page.getByText(gameName, { exact: true }) });
}

/** Open the Rename dialog on the hub's Admin → Hubs row. */
async function openAdminRename(page: Page, name: string, gameName: string): Promise<Locator> {
    await page.goto(ADMIN_HUBS_ACTIVE);
    const row = adminRow(page, name, gameName);
    await expect(row, `"${name}" is listed once on the Active tab`).toHaveCount(1, { timeout: 20_000 });
    await row.getByRole('button', { name: 'Rename', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Rename “${name}”` });
    await expect(dialog).toBeVisible();
    return dialog;
}

/** Open the hub's settings sheet; returns the sheet. */
async function openSettings(page: Page, hubId: number): Promise<Locator> {
    await page.goto(`/hubs/${hubId}`);
    await page.getByTestId('guild-settings-trigger').click({ timeout: 20_000 });
    const sheet = page.getByTestId('guild-settings-sheet');
    await expect(sheet).toBeVisible();
    return sheet;
}

function hero(page: Page, name: string): Locator {
    return page.getByRole('heading', { name, level: 1, exact: true });
}

test.describe('hub rename — community hub (ROK-1950)', () => {
    test('Admin → Hubs: Rename shows the new name on the row, the hub hero and the /hubs card', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const seed = await seedCommunity(admin, testInfo);
        const gameName = await adminGameName(admin, seed.hubIds.crew);
        const next = uniqueName(testInfo, 'Renamed');

        const dialog = await openAdminRename(page, 'Seed Crew', gameName);
        await dialog.getByTestId('admin-hub-rename-input').fill(next);
        await dialog.getByRole('button', { name: 'Save name' }).click();
        await expect(dialog, 'the dialog closes only on a successful rename').toBeHidden({ timeout: 20_000 });
        await expect.poll(async () => (await hubName(admin, seed.hubIds.crew)).name, {
            message: 'the admin rename must reach the API',
        }).toBe(next);
        await expect(adminRow(page, next, gameName), 'the row shows the new name').toHaveCount(1, { timeout: 15_000 });

        await page.goto(`/hubs/${seed.hubIds.crew}`);
        await expect(hero(page, next), 'the hub hero shows the new name').toBeVisible({ timeout: 20_000 });
        await page.goto(`/hubs?game=${seed.gameId}`);
        const card = page.getByTestId('hub-directory-card').filter({ has: page.getByRole('link', { name: next, exact: true }) });
        await expect(card, 'the /hubs directory card shows the new name').toHaveCount(1, { timeout: 20_000 });
    });

    test('Admin → Hubs: another hub’s name in a different case shows the 409 inline and keeps the dialog open', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const seed = await seedCommunity(admin, testInfo);
        const gameName = await adminGameName(admin, seed.hubIds.solo);

        const dialog = await openAdminRename(page, 'Seed Solo', gameName);
        await dialog.getByTestId('admin-hub-rename-input').fill('seed crew');
        await dialog.getByRole('button', { name: 'Save name' }).click();
        await expect(dialog.getByRole('alert'), 'the nameTaken copy renders inline').toHaveText(NAME_TAKEN, { timeout: 15_000 });
        await expect(dialog, 'a refused rename keeps the dialog open').toBeVisible();
        expect((await hubName(admin, seed.hubIds.solo)).name, 'a refused rename writes nothing').toBe('Seed Solo');
    });

    test('Leader: settings → Hub name → Save updates the hero without a reload', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const seed = await seedCommunity(admin, testInfo);
        const next = uniqueName(testInfo, 'Leader named');
        await signInOnboardedMember(page, seed.leaderUserId);

        const sheet = await openSettings(page, seed.hubIds.crew);
        const section = sheet.getByTestId('hub-name-section');
        await expect(section, 'the Leader sees "Hub name"').toBeVisible();
        await expect(section.getByTestId('hub-name-reset'), 'a community hub has no Reset').toHaveCount(0);
        await expect(section.getByTestId('hub-name-save'), 'Save waits for a change').toBeDisabled();
        await section.getByTestId('hub-name-input').fill(next);
        await section.getByTestId('hub-name-save').click();

        await expect.poll(async () => (await hubName(admin, seed.hubIds.crew)).name, {
            message: 'the Leader rename must reach the API',
        }).toBe(next);
        await expect(page.getByText('Hub renamed').first(), 'the success toast').toBeVisible({ timeout: 15_000 });
        await expect(hero(page, next), 'the hero updates without a reload').toBeVisible({ timeout: 15_000 });
    });

    test('Officer: settings has no "Hub name" (Description stays)', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const seed = await seedCommunity(admin, testInfo);
        await signInOnboardedMember(page, must(seed.memberUserIds[0], 'officer id'));

        const sheet = await openSettings(page, seed.hubIds.crew);
        await expect(sheet.getByLabel('Short description'), 'the Officer keeps the blurb edit').toBeVisible();
        await expect(sheet.getByTestId('hub-name-section'), 'an Officer cannot rename').toHaveCount(0);
    });
});

test.describe('hub rename — server hub (ROK-1950)', () => {
    test('admin renames from the settings sheet, then "Reset to server name" falls back', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const hubId = await seedServerHub(admin, testInfo);
        const seeded = await hubName(admin, hubId);
        const source = must(seeded.serverName, 'server.serverName on the server-hub page');
        expect(seeded, 'the seed starts on the server name').toMatchObject({ name: source, nameOverridden: false });
        const next = uniqueName(testInfo, 'Server named');
        try {
            const sheet = await openSettings(page, hubId);
            const section = sheet.getByTestId('hub-name-section');
            await expect(section, 'the hint names the Pelican server').toContainText(`Pelican calls this server “${source}”.`);
            await expect(section.getByTestId('hub-name-reset'), 'no Reset before a rename').toHaveCount(0);
            await section.getByTestId('hub-name-input').fill(next);
            await section.getByTestId('hub-name-save').click();
            await expect.poll(() => hubName(admin, hubId), { message: 'the rename sets the override' })
                .toMatchObject({ name: next, nameOverridden: true });
            await expect(hero(page, next), 'the hero shows the Raid Ledger name').toBeVisible({ timeout: 15_000 });

            const reset = sheet.getByTestId('hub-name-section').getByTestId('hub-name-reset');
            await expect(reset, 'Reset appears once the hub carries its own name').toBeVisible({ timeout: 15_000 });
            await reset.click();
            await expect.poll(() => hubName(admin, hubId), { message: 'Reset clears the override' })
                .toMatchObject({ name: source, nameOverridden: false });
            await expect(hero(page, source), 'the hero falls back to the server name').toBeVisible({ timeout: 15_000 });
            await expect(sheet.getByTestId('hub-name-reset'), 'Reset disappears after the fallback').toHaveCount(0, { timeout: 15_000 });
        } finally {
            await apiPatch(admin, `/guilds/${hubId}/name`, { name: null }).catch(() => undefined);
        }
    });
});

test.describe('hub rename — WoW guild (ROK-2015)', () => {
    test('admin renames from the settings sheet, then "Reset to in-game name" falls back', async ({ page }, testInfo) => {
        const admin = await getAdminToken();
        const seed = await seedWowGuild(admin, testInfo);
        try {
            expect(await hubName(admin, seed.guildId), 'the seed starts on its in-game name')
                .toMatchObject({ name: seed.name, nameOverridden: false, inGameName: seed.name });
            const next = uniqueName(testInfo, 'Guild named');
            const sheet = await openSettings(page, seed.guildId);
            const section = sheet.getByTestId('hub-name-section');
            await expect(section, 'an admin sees "Hub name" on a WoW guild').toBeVisible();
            await expect(section.getByTestId('hub-name-reset'), 'no Reset before a rename').toHaveCount(0);
            await section.getByTestId('hub-name-input').fill(next);
            await section.getByTestId('hub-name-save').click();
            await expect.poll(() => hubName(admin, seed.guildId), { message: 'the rename sets the override' })
                .toMatchObject({ name: next, nameOverridden: true, inGameName: seed.name });
            await expect(hero(page, next), 'the hero shows the Raid Ledger name').toBeVisible({ timeout: 15_000 });
            await expect(sheet.getByTestId('hub-name-section'), 'the hint names the in-game guild')
                .toContainText(`In game this guild is called “${seed.name}”.`, { timeout: 15_000 });

            const reset = sheet.getByTestId('hub-name-section').getByTestId('hub-name-reset');
            await expect(reset, 'Reset appears once the guild carries its own name').toHaveText('Reset to in-game name', { timeout: 15_000 });
            await reset.click();
            await expect.poll(() => hubName(admin, seed.guildId), { message: 'Reset restores the in-game name' })
                .toMatchObject({ name: seed.name, nameOverridden: false });
            await expect(hero(page, seed.name), 'the hero falls back to the in-game name').toBeVisible({ timeout: 15_000 });
            await expect(sheet.getByTestId('hub-name-reset'), 'Reset disappears after the fallback').toHaveCount(0, { timeout: 15_000 });
        } finally {
            await apiPatch(admin, `/guilds/${seed.guildId}/name`, { name: null }).catch(() => undefined);
            for (const id of seed.userIds) await apiDelete(admin, `/users/${id}`).catch(() => undefined);
        }
    });
});
