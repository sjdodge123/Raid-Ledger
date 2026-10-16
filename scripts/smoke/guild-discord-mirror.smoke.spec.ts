/**
 * Guild page Discord channel mirror smoke (ROK-1788, S4 of ROK-1781) — every
 * project (desktop, tablet and mobile).
 *
 * No live bot needed: each test registers its OWN fabricated channel through
 * the DEMO_MODE seam `POST /admin/test/wow/guild-discord-channel` (a per-test
 * snowflake; four messages oldest-first, the newest carrying an embed) and its
 * own guild through `POST /admin/test/wow/seed-guild` (a per-project, per-
 * worker, per-run name). Binding goes through the REAL picker or the REAL
 * `PUT .../discord/channel`. Cleanup forgets the channel, unbinds, and deletes
 * the seeded users in `finally`.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, apiPut, getAdminToken } from './api-helpers';
import { signInAsAdmin, signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

interface Fixture {
    token: string;
    guild: SeededGuild;
    channelId: string;
}

/** A 17-digit snowflake unique to this run, worker and call. */
let channelSeq = 0;
function channelIdFor(testInfo: TestInfo): string {
    channelSeq += 1;
    return `9${Date.now()}${String(testInfo.workerIndex % 100).padStart(2, '0')}${channelSeq % 10}`;
}

function guildName(testInfo: TestInfo): string {
    return `Mirror ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: body.guildId, users: body.users };
}

async function registerChannel(token: string, channelId: string, extra: Record<string, unknown> = {}): Promise<void> {
    const body = (await apiPost(token, '/admin/test/wow/guild-discord-channel', {
        channelId, name: `mirror-smoke-${channelId.slice(-4)}`, ...extra,
    })) as { read?: { state?: string } };
    if (body.read?.state !== (extra.state ?? 'ok')) throw new Error(`guild-discord-channel: ${JSON.stringify(body)}`);
}

/** Seed a guild + a fabricated channel, run `body`, always clean both up. */
async function withMirror(
    testInfo: TestInfo,
    channel: Record<string, unknown>,
    body: (fx: Fixture) => Promise<void>,
): Promise<void> {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    const channelId = channelIdFor(testInfo);
    try {
        await registerChannel(token, channelId, channel);
        await body({ token, guild, channelId });
    } finally {
        await apiDelete(token, `/plugins/wow/guilds/${guild.guildId}/discord/channel`).catch(() => undefined);
        await apiPost(token, '/admin/test/wow/guild-discord-channel', { channelId, remove: true }).catch(() => undefined);
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

/** Bind through the real editor route (admin is staff, so no chooser check). */
async function bindAsAdmin(fx: Fixture, privateAck?: boolean): Promise<void> {
    const res = (await apiPut(fx.token, `/plugins/wow/guilds/${fx.guild.guildId}/discord/channel`, {
        channelId: fx.channelId, ...(privateAck ? { privateAck } : {}),
    })) as { state?: string };
    if (res.state !== 'ok') throw new Error(`bind: ${JSON.stringify(res)}`);
}

/** Open the guild Overview and wait for the mirror GET to answer. */
async function openOverview(page: Page, guildId: number): Promise<void> {
    const mirrorRead = page.waitForResponse((r) =>
        r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/plugins/wow/guilds/${guildId}/discord`));
    await page.goto(`/guilds/${guildId}`);
    expect((await mirrorRead).status(), 'GET .../discord answers 200').toBe(200);
}

async function expectThreeLatest(page: Page, channelId: string): Promise<void> {
    const card = page.getByTestId('guild-discord-mirror');
    await expect(card).toHaveAttribute('data-state', 'ok', { timeout: 15_000 });
    const rows = card.getByTestId('guild-discord-messages').getByTestId('thread-message-row');
    await expect(rows, 'the card shows the latest 3 of 4, oldest first').toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Mirror smoke message two');
    await expect(rows.nth(2)).toContainText('Mirror smoke message four');
    await expect(card, 'the oldest message is sliced off').not.toContainText('Mirror smoke message one');
    await expect(card.getByTestId('guild-discord-embed')).toContainText('Raid signups are open');
    await expect(card.getByTestId('guild-discord-open')).toHaveAttribute(
        'href', new RegExp(`^https://discord\\.com/channels/\\d+/${channelId}$`));
}

test('editor (rank-1 officer): binds a readable channel and the card shows the latest 3 messages', async ({ page }, testInfo) => {
    await withMirror(testInfo, {}, async (fx) => {
        await signInOnboardedMember(page, fx.guild.users.officer.userId);
        await openOverview(page, fx.guild.guildId);
        const card = page.getByTestId('guild-discord-mirror');
        await expect(card).toHaveAttribute('data-state', 'unset');
        await card.getByTestId('guild-discord-choose').click();
        const select = page.getByTestId('guild-discord-channel-select');
        await expect(select.locator(`option[value="${fx.channelId}"]`)).toHaveCount(1, { timeout: 15_000 });
        await select.selectOption(fx.channelId);
        await expect(page.getByTestId('guild-discord-private-ack'), 'a public channel needs no ack').toHaveCount(0);
        await page.getByTestId('guild-discord-save').click();
        await expect(page.getByTestId('guild-discord-picker-body')).toHaveCount(0);
        await expectThreeLatest(page, fx.channelId);
        await expect(card.getByTestId('guild-discord-change'), 'the editor can change the channel').toBeVisible();
    });
});

test('member: no card when no channel is bound', async ({ page }, testInfo) => {
    await withMirror(testInfo, {}, async (fx) => {
        await signInOnboardedMember(page, fx.guild.users.member.userId);
        await openOverview(page, fx.guild.guildId);
        await expect(page.getByRole('navigation', { name: 'Guild page sections' }), 'the guild page rendered').toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-discord-mirror'), 'an unbound card is hidden from non-editors').toHaveCount(0);
    });
});

test('member: sees the bound channel read-only, with no picker controls', async ({ page }, testInfo) => {
    await withMirror(testInfo, {}, async (fx) => {
        await bindAsAdmin(fx);
        await signInOnboardedMember(page, fx.guild.users.member.userId);
        await openOverview(page, fx.guild.guildId);
        await expectThreeLatest(page, fx.channelId);
        for (const id of ['guild-discord-change', 'guild-discord-choose', 'guild-discord-picker-body']) {
            await expect(page.getByTestId(id), `${id} is editor-only`).toHaveCount(0);
        }
    });
});

test('staff editor: a private channel is hidden until shown and needs the acknowledgement to save', async ({ page }, testInfo) => {
    await withMirror(testInfo, { visibility: 'private' }, async (fx) => {
        await signInAsAdmin(page.context());
        await openOverview(page, fx.guild.guildId);
        await page.getByTestId('guild-discord-mirror').getByTestId('guild-discord-choose').click();
        const select = page.getByTestId('guild-discord-channel-select');
        const option = select.locator(`option[value="${fx.channelId}"]`);
        await expect(select, 'the channel list loaded').toBeVisible({ timeout: 15_000 });
        await expect(option, 'private channels start hidden').toHaveCount(0);
        await page.getByTestId('guild-discord-show-private').check();
        await expect(option).toHaveCount(1);
        await select.selectOption(fx.channelId);
        const save = page.getByTestId('guild-discord-save');
        await expect(save, 'Save stays disabled until the ack is ticked').toBeDisabled();
        await page.getByTestId('guild-discord-private-ack').check();
        await expect(save).toBeEnabled();
        await save.click();
        await expectThreeLatest(page, fx.channelId);
        const read = (await apiGet(fx.token, `/plugins/wow/guilds/${fx.guild.guildId}/discord`)) as { channel?: { visibility?: string } };
        expect(read.channel?.visibility, 'the binding is the private channel').toBe('private');
    });
});
