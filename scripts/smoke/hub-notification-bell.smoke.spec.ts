/**
 * Per-group hub notification bell smoke (ROK-1832) — desktop, tablet AND mobile.
 *
 * Every test seeds its OWN guild through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` (`withContent: true`, a per-project,
 * per-worker, per-run name), so the parallel projects never share a group or a
 * viewer. The fixture's plain `member` (rank 3) is a live member, which is what
 * D11 gates the bell on; its `outsider` has no character and is a visitor. Each
 * viewer signs in with its own session, and the member's own JWT drives the
 * API reads, since the mute is a per-user row. Seeded users are deleted in
 * `finally` (the mute row cascades with them); the guild stays (disposable env).
 *
 * The panel is an anchored popover at/above 1024px and a `BottomSheet` dialog
 * below it, so the tablet project (768–1023px) takes the sheet path too.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

/** The shared `NotifyBell` switches from popover to `BottomSheet` below this. */
const POPOVER_MIN_WIDTH = 1024;

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Bell ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
        withContent: true,
    })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) {
        throw new Error(`seed-guild withContent: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

/** Seed a content guild, run `body`, and always delete the seeded users. */
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

/** Sign in as the seeded member, open the group page, return the member's JWT. */
async function openAsMember(page: Page, guild: SeededGuild): Promise<string> {
    const jwt = await signInOnboardedMember(page, guild.users.member.userId);
    await page.goto(`/guilds/${guild.guildId}`);
    await expect(page.getByTestId('guild-hero')).toBeVisible({ timeout: 15_000 });
    return jwt;
}

/** The member's muted group ids, read through `GET /notifications/hub-mutes`. */
async function mutedGroupIds(jwt: string): Promise<number[]> {
    const res = (await apiGet(jwt, '/notifications/hub-mutes')) as { data?: Array<{ guildId: number }> } | null;
    expect(res, 'GET /notifications/hub-mutes must answer 2xx').not.toBeNull();
    return (res?.data ?? []).map((g) => g.guildId);
}

function usesSheet(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) < POPOVER_MIN_WIDTH;
}

/** The open panel: the popover ≥1024px, the named `BottomSheet` dialog below. */
function panelFor(page: Page): Locator {
    return usesSheet(page)
        ? page.getByRole('dialog', { name: /^Notifications for / })
        : page.getByTestId('hub-notify-popover');
}

test('member: the bell sits in the hero; muting flips the label and survives a reload', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        const jwt = await openAsMember(page, guild);
        const bell = page.getByTestId('guild-hero').getByTestId('hub-notify-bell');
        await expect(bell, 'a live member sees the group bell in the hero').toBeVisible({ timeout: 15_000 });
        await expect(bell).toHaveAttribute('aria-label', /^Notifications for .+: on$/);

        await bell.click();
        const panel = panelFor(page);
        await expect(panel, 'clicking the bell must open the panel').toBeVisible();
        await expect(panel).toContainText('Muting keeps you in the group.');
        const toggle = panel.getByTestId('hub-notify-switch');
        await expect(toggle, 'a fresh member starts with group notifications on').toHaveAttribute('aria-checked', 'true');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await expect.poll(() => mutedGroupIds(jwt), { message: 'the mute must reach the API' }).toContain(guild.guildId);

        await page.reload();
        const reloaded = page.getByTestId('hub-notify-bell');
        await expect(reloaded, 'the mute must survive a reload').toHaveAttribute('aria-label', /: muted$/, {
            timeout: 15_000,
        });
        await reloaded.click();
        await expect(panelFor(page).getByTestId('hub-notify-switch')).toHaveAttribute('aria-checked', 'false');
    });
});

test('member: below 1024px the bell opens a BottomSheet, at/above it a popover', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openAsMember(page, guild);
        await page.getByTestId('hub-notify-bell').click();
        const sheet = page.getByRole('dialog', { name: /^Notifications for / });
        const popover = page.getByTestId('hub-notify-popover');
        if (usesSheet(page)) {
            await expect(sheet, 'a narrow viewport opens the BottomSheet').toBeVisible({ timeout: 15_000 });
            await expect(popover, 'no anchored popover below 1024px').toHaveCount(0);
        } else {
            await expect(popover, 'a wide viewport opens the anchored popover').toBeVisible({ timeout: 15_000 });
        }
        await expect(panelFor(page).getByRole('link', { name: /settings/i })).toHaveAttribute(
            'href',
            '/profile/notifications#notif-hub_leader_post',
        );
    });
});

test('/profile/notifications lists the muted group and Unmute removes it', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        const jwt = await openAsMember(page, guild);
        await apiPost(jwt, `/guilds/${guild.guildId}/notification-mute`);

        await page.goto('/profile/notifications');
        await expect(page.locator('#notif-hub_leader_post'), 'the Group posts row renders').toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#notif-hub_event_tagged'), 'the Group events row renders').toBeVisible();
        const list = page.getByTestId('muted-groups-list');
        await expect(list, 'the muted-groups list must render').toBeVisible();
        const item = list.locator('li', { has: page.locator(`a[href="/guilds/${guild.guildId}"]`) });
        await expect(item, 'the muted group must be listed').toHaveCount(1);

        await item.getByRole('button', { name: /^Unmute / }).click();
        await expect(item, 'Unmute must remove the group from the list').toHaveCount(0);
        await expect.poll(() => mutedGroupIds(jwt), { message: 'the unmute must reach the API' }).not.toContain(
            guild.guildId,
        );
    });
});

test('visitor: a non-member sees no bell', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await signInOnboardedMember(page, guild.users.outsider.userId);
        await page.goto(`/guilds/${guild.guildId}`);
        await expect(page.getByTestId('guild-not-member')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('hub-notify-bell'), 'D11: the bell is member-only').toHaveCount(0);
    });
});
