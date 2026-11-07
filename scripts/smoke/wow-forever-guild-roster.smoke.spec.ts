/**
 * ROK-1928 A4/D2 — a WoW: Forever guild hub's settings sheet carries the
 * "Blizzard roster" section: the stored Blizzard guild slug and, after a
 * successful sync, the "Roster via Blizzard · synced …" line. Desktop AND mobile.
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785; a Forever guild by
 * default) with a per-project, per-worker, per-run name. The slug is set
 * through the real `PATCH /plugins/wow/guilds/:id/blizzard-roster`.
 *
 * Status `ok` cannot be seeded: no `/admin/test/*` fixture writes
 * `guilds.blizzard_roster_status`, and the only real writer is the sync, which
 * calls Blizzard. The browser's GET of the roster view is therefore passed
 * through to the real API and only its `status`/`syncedAt` are overridden
 * (`page.route` + `route.fetch`) — the slug asserted below is the server's.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPatch, apiPost, getAdminToken } from './api-helpers';
import { signInAsAdmin } from './browser-session';

interface SeededGuild {
    guildId: number;
    users: Record<string, { userId: number }>;
}

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Roster ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: body.guildId, users: body.users };
}

/** Serve the real roster view with the last sync reported as `ok` an hour ago. */
async function reportSyncedOk(page: Page, guildId: number): Promise<void> {
    await page.route(`**/plugins/wow/guilds/${guildId}/blizzard-roster`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const real = (await response.json()) as Record<string, unknown>;
        const syncedAt = new Date(Date.now() - 3_600_000).toISOString();
        await route.fulfill({ response, json: { ...real, status: 'ok', syncedAt } });
    });
}

test('admin: the settings sheet shows the Blizzard slug and the "Roster via Blizzard" line', async ({ page }, testInfo) => {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    const slug = `smoke-roster-${testInfo.workerIndex}`;
    try {
        await apiPatch(token, `/plugins/wow/guilds/${guild.guildId}/blizzard-roster`, { guildSlug: slug });
        await reportSyncedOk(page, guild.guildId);
        await signInAsAdmin(page.context());
        await page.goto(`/hubs/${guild.guildId}`);
        const trigger = page.getByTestId('guild-settings-trigger');
        await expect(trigger).toBeVisible({ timeout: 15_000 });
        await trigger.click();
        const section = page.getByTestId('wow-blizzard-roster-section');
        await expect(section, 'Forever guild hubs carry the Blizzard roster section').toBeVisible({ timeout: 15_000 });
        await expect(section.getByTestId('wow-blizzard-roster-input')).toHaveValue(slug);
        await expect(section.getByTestId('wow-blizzard-roster-status')).toHaveText(/^Roster via Blizzard · synced /);
        await expect(section.getByTestId('wow-blizzard-roster-sync'), 'a stored slug offers Sync now').toBeVisible();
    } finally {
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
});
