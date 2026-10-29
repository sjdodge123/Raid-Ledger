/**
 * ROK-1817 — "Schedule for guild" on the WoW guild page's Raids tab, desktop
 * AND mobile. A guild editor follows it to Create Event with the guild's game
 * and the guild preselected, saves, and the event is tagged to the guild and
 * listed on its Events tab. A plain member never sees the button. (A
 * non-editor's crafted deep link is refused server-side — 403, covered by
 * `api/src/plugins/wow-common/guilds/guild-event-tag.integration.spec.ts`.)
 *
 * Each test seeds its OWN guild through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` (unique per project, worker and run), as
 * `guild-page.smoke.spec.ts` does; seeded users and the created event are
 * deleted in `finally`.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

const BUTTON = 'guild-schedule-for-guild';

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const name = `Sched ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: body.guildId, users: body.users };
}

/** Seed a guild, run `body`, and always delete the seeded users. */
async function withGuild(testInfo: TestInfo, body: (guild: SeededGuild, adminToken: string) => Promise<void>) {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        await body(guild, token);
    } finally {
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

/** Fill the required Create Event fields (tomorrow 20:00, 2h). */
async function fillRequiredFields(page: Page, title: string): Promise<void> {
    await page.getByRole('textbox', { name: 'Event Title' }).fill(title);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.getByRole('textbox', { name: 'Date' }).fill(tomorrow);
    await page.getByRole('textbox', { name: 'Start Time' }).fill('20:00');
    await page.getByRole('radio', { name: '2h', exact: true }).locator('xpath=..').click();
    await expect(page.getByRole('radio', { name: '2h', exact: true })).toBeChecked();
}

test('editor: "Schedule for guild" opens Create Event pre-linked to the guild, and the saved event is tagged to it', async ({ page, world }, testInfo) => {
    await withGuild(testInfo, async (guild, adminToken) => {
        const jwt = await signInOnboardedMember(page, guild.users.officer.userId);
        await page.goto(`/hubs/${guild.guildId}#raids`);
        const button = page.getByTestId(BUTTON);
        await expect(button, 'the officer is a guild editor (granted by name)').toBeVisible({ timeout: 15_000 });
        await expect(button).toHaveText('Schedule for guild');
        await button.click();

        await expect(page).toHaveURL(new RegExp(`/events/new\\?gameId=\\d+&guildId=${guild.guildId}$`));
        await expect(page.getByRole('heading', { name: 'Create Event', level: 1 })).toBeVisible({ timeout: 15_000 });
        const guildField = page.getByTestId('event-guild-field');
        await expect(guildField, 'the guild\'s game is preselected, so the Guild field renders').toBeVisible({ timeout: 15_000 });
        await expect(guildField.getByRole('combobox'), 'the Guild field is set to this guild').toHaveValue(String(guild.guildId));

        const title = world.uid('guild-event');
        await fillRequiredFields(page, title);
        await page.getByRole('button', { name: 'Create Event' }).click();
        await page.waitForURL(/\/events\/\d+/, { timeout: 15_000 });
        const eventId = page.url().match(/\/events\/(\d+)/)?.[1];
        expect(eventId, 'Create Event redirects to the new event').toBeTruthy();
        try {
            const event = (await apiGet(jwt, `/events/${eventId}`)) as { guildId?: number | null } | null;
            expect(event?.guildId, 'the saved event carries guild_id').toBe(guild.guildId);
            await page.goto(`/hubs/${guild.guildId}#events`);
            await expect(page.getByTestId('guild-events-tab').getByText(title), 'the event is listed on the guild\'s Events tab').toBeVisible({ timeout: 15_000 });
        } finally {
            if (eventId) await apiDelete(adminToken, `/events/${eventId}`).catch(() => undefined);
        }
    });
});

test('plain member: the Raids tab has no "Schedule for guild"', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await signInOnboardedMember(page, guild.users.member.userId);
        await page.goto(`/hubs/${guild.guildId}#raids`);
        await expect(page.getByTestId('guild-raids-tab')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId(BUTTON), 'a non-editor must not see "Schedule for guild"').toHaveCount(0);
    });
});
