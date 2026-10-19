/**
 * ROK-1831 — opt-in game-server community hub smoke (desktop + mobile).
 *
 * Seed: `POST /admin/test/pelican/server-hub` (DEMO_MODE) resets THIS worker's
 * slot (`1 + parallelIndex`; slot 0 is the fleet test plan's) — a Valheim-mapped
 * server with its hub on, members online-row (seen now, "Bjorn"), recent (seen
 * 10 d), joined (manual Join, never played), lapsed (seen 100 d — NOT a
 * member), an outsider, and one past Quick Play session. Per-slot, so the
 * parallel projects never hide or join each other's hub; re-run = reset.
 *
 * "N online" reads the in-memory presence roster, which no fixture can fill
 * (the demo panel is unreachable), so the pill is checked against the API's
 * own `onlineNow` count rather than a hardcoded 1.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPatch, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInAsAdmin, signInOnboardedMember } from './browser-session';

type Role = 'online' | 'recent' | 'joined' | 'lapsed' | 'outsider';

interface Hub {
    slot: number;
    serverId: number;
    guildId: number;
    eventId: number;
    userIds: Record<Role, number>;
}

interface PageMember { name: string; server?: { onlineNow: boolean } }
interface HubPage { ranks: { members: PageMember[] }[] }

const ADMIN_PELICAN = '/admin/settings/integrations/plugin/pelican/pelican-panel';

/** Mirrors `serverHubUserName` in the API seed. */
function userName(slot: number, role: Role): string {
    return `Hub ${slot} ${role[0]?.toUpperCase() ?? ''}${role.slice(1)}`;
}

async function seedHub(token: string): Promise<Hub> {
    const slot = 1 + (test.info().parallelIndex % 15);
    const body = (await apiPost(token, '/admin/test/pelican/server-hub', { slot })) as Partial<Hub> | null;
    if (typeof body?.guildId !== 'number' || typeof body.serverId !== 'number' || !body.userIds) {
        throw new Error(`server-hub seed failed: ${JSON.stringify(body)}`);
    }
    return { slot, serverId: body.serverId, guildId: body.guildId, eventId: body.eventId ?? -1, userIds: body.userIds };
}

async function members(token: string, guildId: number): Promise<PageMember[]> {
    const body = (await apiGet(token, `/guilds/${guildId}`)) as HubPage | null;
    return (body?.ranks ?? []).flatMap((g) => g.members);
}

/** Poll the API roster until `name` is (or is no longer) a member. */
async function waitForMember(token: string, hub: Hub, name: string, present: boolean): Promise<void> {
    await pollForCondition(async () => {
        const names = (await members(token, hub.guildId)).map((m) => m.name);
        return names.includes(name) === present ? true : null;
    }, { timeoutMs: 15_000, description: `${name} ${present ? 'joined' : 'left'} hub ${hub.guildId}` });
}

function memberRow(page: Page, name: string) {
    return page.getByTestId('guild-member-row').filter({ hasText: name }).filter({ visible: true });
}

test.describe('Server community hub (ROK-1831)', () => {
    test('hub page: status pill, online count, Members columns; the 100-day player is absent', async ({ page }) => {
        const token = await getAdminToken();
        const hub = await seedHub(token);
        const online = (await members(token, hub.guildId)).filter((m) => m.server?.onlineNow === true).length;
        await page.goto(`/guilds/${hub.guildId}`);
        await expect(page.getByTestId('server-hub-status')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('server-hub-online')).toHaveText(`${online} online`);

        await page.goto(`/guilds/${hub.guildId}#members`);
        await expect(page.getByTestId('guild-members')).toBeVisible({ timeout: 15_000 });
        const a = memberRow(page, userName(hub.slot, 'online'));
        await expect(a.getByTestId('server-member-character')).toHaveText('Bjorn');
        await expect(a.getByTestId('server-member-online')).toBeVisible();
        await expect(a.getByTestId('server-member-last-seen')).toContainText('Last seen');
        await expect(memberRow(page, userName(hub.slot, 'recent')).getByTestId('server-member-last-seen')).toHaveText('Last seen 10 days ago');
        await expect(memberRow(page, userName(hub.slot, 'joined')).getByTestId('server-member-last-seen')).toHaveText('Joined, not played yet');
        await expect(memberRow(page, userName(hub.slot, 'lapsed'))).toHaveCount(0);
        await expect(memberRow(page, userName(hub.slot, 'outsider'))).toHaveCount(0);
    });

    test('outsider: Join makes them a member, Leave (confirmed) removes them', async ({ page }) => {
        const token = await getAdminToken();
        const hub = await seedHub(token);
        const name = userName(hub.slot, 'outsider');
        await signInOnboardedMember(page, hub.userIds.outsider);
        await page.goto(`/guilds/${hub.guildId}`);
        await page.getByTestId('server-hub-join').click({ timeout: 15_000 });
        await waitForMember(token, hub, name, true);
        await expect(page.getByTestId('server-hub-leave')).toBeVisible();

        await page.getByTestId('server-hub-leave').click();
        await expect(page.getByTestId('server-hub-leave-confirm')).toBeVisible();
        await page.getByTestId('server-hub-leave-yes').click();
        await waitForMember(token, hub, name, false);
        await expect(page.getByTestId('server-hub-join')).toBeVisible();
    });

    test('Quick Play tab lists the seeded session', async ({ page }) => {
        const hub = await seedHub(await getAdminToken());
        await page.goto(`/guilds/${hub.guildId}#quick-play`);
        await expect(page.getByTestId('server-hub-quick-play')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('server-hub-quick-play-row')).toHaveCount(1);
    });

    test('admin hides the hub: outsider gets not-found, admin still sees it; switching back restores', async ({ page }) => {
        const token = await getAdminToken();
        const hub = await seedHub(token);
        const servers = `/admin/plugins/pelican/servers/${hub.serverId}`;
        try {
            await page.goto(ADMIN_PELICAN);
            await setHubSwitch(page, hub, false);
            await expect(page.getByTestId(`pelican-server-${hub.serverId}-hub-hidden`).filter({ visible: true })).toBeVisible();

            await page.goto(`/guilds/${hub.guildId}`);
            await expect(page.getByTestId('server-hub-status'), 'staff still sees a hidden hub').toBeVisible({ timeout: 15_000 });
            await signInOnboardedMember(page, hub.userIds.outsider);
            await page.goto(`/guilds/${hub.guildId}`);
            await expect(page.getByTestId('guild-not-found')).toBeVisible({ timeout: 15_000 });

            await signInAsAdmin(page.context());
            await page.goto(ADMIN_PELICAN);
            await setHubSwitch(page, hub, true);
            await expect(page.getByTestId(`pelican-server-${hub.serverId}-hub-open`).filter({ visible: true })).toBeVisible();
            await signInOnboardedMember(page, hub.userIds.outsider);
            await page.goto(`/guilds/${hub.guildId}`);
            await expect(page.getByTestId('server-hub-join')).toBeVisible({ timeout: 15_000 });
        } finally {
            await apiPatch(token, servers, { communityHub: true }).catch(() => undefined);
        }
    });
});

/** Flip the row's Community hub switch and wait for the PATCH to land. */
async function setHubSwitch(page: Page, hub: Hub, on: boolean): Promise<void> {
    const sw = page.getByTestId(`pelican-server-${hub.serverId}-hub`).filter({ visible: true });
    await sw.scrollIntoViewIfNeeded({ timeout: 15_000 });
    await expect(sw).toHaveAttribute('aria-checked', String(!on));
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH'
        && r.url().endsWith(`/admin/plugins/pelican/servers/${hub.serverId}`));
    await sw.click();
    expect((await saved).ok(), 'PATCH communityHub failed').toBe(true);
    await expect(sw).toHaveAttribute('aria-checked', String(on));
}
