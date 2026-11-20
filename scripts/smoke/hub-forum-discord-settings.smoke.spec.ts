/**
 * ROK-2208 S3 — hub settings "Discord forum" section, desktop AND mobile.
 *
 * Seeds a community hub through the DEMO_MODE fixture (`./hub-seed`, the
 * tag is per spec × project × worker) and signs in as its Leader (a
 * community Leader holds `canManageDiscord`, §6). The `forum-discord`
 * routes are stubbed with `page.route`: the subject is the settings UI (the
 * Q10 picker, the acknowledgement gate, the bound state, Unlink). The real
 * binding is covered by the api integration spec and the Discord smoke
 * (`hub-forum-discord-binding.test.ts`), which own a real Discord forum.
 */
import type { Page, Route, TestInfo } from '@playwright/test';
import { HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME as SHARED_NAME } from '@raid-ledger/contract';
import { test, expect } from './base';
import { getAdminToken } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';

const PREFLIGHT = {
    botOnline: true, missingToCreate: [], suggestedName: 'seed-crew',
    shared: { channelId: '223456789012345678', name: SHARED_NAME, sharedWith: 1, tagsUsed: 2, tagsFree: 18, tagName: 'Seed Crew', missingPermissions: [] },
};
const SHARED = { id: '223456789012345678', name: SHARED_NAME, sharedWith: 1, tagsFree: 18 };

interface Stub { puts: unknown[]; deletes: string[]; bound: boolean }

function binding(): Record<string, unknown> {
    return {
        channelId: SHARED.id, channelName: SHARED.name, managed: false, shared: true, sharedWith: 1,
        tagName: 'Seed Crew', boundAt: new Date().toISOString(), health: 'ok', missingPermissions: [],
    };
}

async function stubForumDiscord(page: Page, hubId: number): Promise<Stub> {
    const stub: Stub = { puts: [], deletes: [], bound: false };
    const path = `/guilds/${hubId}/forum-discord`;
    await page.route((url) => url.pathname.endsWith(`${path}/preflight`), (route: Route) => route.fulfill({ json: PREFLIGHT }));
    await page.route((url) => url.pathname.endsWith(`${path}/channels`), (route: Route) => route.fulfill({ json: { channels: [SHARED] } }));
    await page.route((url) => url.pathname.endsWith(path), async (route: Route) => {
        const method = route.request().method();
        if (method === 'PUT') { const body: unknown = route.request().postDataJSON(); stub.puts.push(body); stub.bound = true; }
        if (method === 'DELETE') { stub.deletes.push(new URL(route.request().url()).search); stub.bound = false; return route.fulfill({ status: 204 }); }
        return route.fulfill({ json: { binding: stub.bound ? binding() : null } });
    });
    return stub;
}

interface CrewSeed { hubIds: { crew: number }; leaderUserId: number }

function isCrewSeed(body: unknown): body is CrewSeed {
    if (typeof body !== 'object' || body === null || !('hubIds' in body) || !('leaderUserId' in body)) return false;
    const { hubIds, leaderUserId } = body;
    return typeof leaderUserId === 'number' && typeof hubIds === 'object' && hubIds !== null
        && 'crew' in hubIds && typeof hubIds.crew === 'number';
}

async function seedCrew(testInfo: TestInfo): Promise<{ hubId: number; leaderUserId: number }> {
    const body: unknown = await seedCommunityHubs(await getAdminToken(), testInfo, 'hub-forum-discord', { dedicatedGame: true });
    if (!isCrewSeed(body)) throw new Error(`[hub-forum-discord] seed: ${JSON.stringify(body)}`);
    return { hubId: body.hubIds.crew, leaderUserId: body.leaderUserId };
}

test.describe('Hub settings — Discord forum (ROK-2208)', () => {
    test('a Leader turns sync on behind the acknowledgement, then unlinks', async ({ page }, testInfo) => {
        const { hubId, leaderUserId } = await seedCrew(testInfo);
        await signInOnboardedMember(page, leaderUserId);
        const stub = await stubForumDiscord(page, hubId);
        await page.goto(`/hubs/${hubId}`);
        await page.getByTestId('guild-settings-trigger').click({ timeout: 20_000 });
        const section = page.getByTestId('guild-settings-forum-discord');
        await section.scrollIntoViewIfNeeded();

        await expect(section.getByTestId('hub-forum-discord-preflight')).toBeVisible();
        await expect(section.getByRole('radio', { name: /Shared server forum/ })).toBeChecked();
        const turnOn = section.getByTestId('hub-forum-discord-turn-on');
        await expect(turnOn).toBeDisabled();
        await section.getByTestId('hub-forum-discord-ack').check();
        await turnOn.click();
        await expect.poll(() => stub.puts).toEqual([{ mode: 'create', target: 'shared', ack: true }]);
        await expect(section.getByTestId('hub-forum-discord-channel-name')).toHaveText(`#${SHARED_NAME}`);
        await expect(section.getByTestId('hub-forum-discord-shared')).toHaveText('Shared with 1 other hub · tag Seed Crew');

        await section.getByTestId('hub-forum-discord-unlink').click();
        await expect(page.getByTestId('hub-forum-discord-unlink-dialog')).toContainText('Other hubs share this forum');
        await page.getByTestId('hub-forum-discord-unlink-confirm').click();
        await expect.poll(() => stub.deletes).toEqual(['']);
        await expect(section.getByTestId('hub-forum-discord-form')).toBeVisible();
    });
});
