/**
 * ROK-1875 — one "Hubs" nav item (header menu from 768px; the bottom bar's
 * raised centre Hubs circle + the More drawer below it) + the all-kinds `/hubs` directory smoke
 * (desktop, mobile AND tablet).
 *
 * Seed, per project (the projects run in parallel; tests in a file run in
 * order, `fullyParallel: false`):
 *  - a server hub: `POST /admin/test/pelican/server-hub { slot }` on slot
 *    15 / 14 / 13 (server-hub.smoke uses `1 + parallelIndex % 15` from the
 *    bottom, slot 0 is the fleet test plan's). Re-seeding resets the slot. Its
 *    `outsider` is in no hub at all — the no-hubs viewer (signed in on its own).
 *  - community hubs: `POST /admin/test/community-hubs/seed { gameId }` on a
 *    configured game the community-hubs spec does not seed (index 3 + project
 *    slot; that spec takes indexes 0–2) → "Seed Crew" (the actor is in it) and
 *    "Seed Solo" (the actor is not).
 *  - the actor: that seed's officer, made a server-hub member through
 *    `POST /admin/test/hub-member { guildId, userId }` → hubs of two kinds.
 * Every write is confirmed by polling `GET /guilds/mine` with the actor's own
 * JWT before the UI is read (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isDesktop } from './helpers';

interface ServerHub { guildId: number; userIds: { outsider: number } }
interface CommunitySeed { gameId: number; hubIds: { crew: number; solo: number }; memberUserIds: number[] }
interface MyHub { id: number; name: string; kind: string }
interface Seed { serverHubId: number; serverHubName: string; crewId: number; gameId: number; actorId: number }

/** Header `md:` — from 768px the header carries the Hubs item; below it the More drawer. */
const HEADER_HUBS_MIN_WIDTH = 768;
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };

function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hubs-nav] missing ${label}`);
    return value;
}

function slotOf(testInfo: TestInfo): number {
    return PROJECT_SLOT[testInfo.project.name] ?? 0;
}

async function communityGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[hubs-nav] GET /games/configured returned no games');
    return must(ids[(3 + slotOf(testInfo)) % ids.length], 'community game id');
}

async function seedServerHub(token: string, testInfo: TestInfo): Promise<ServerHub> {
    const body = (await apiPost(token, '/admin/test/pelican/server-hub', { slot: 15 - slotOf(testInfo) })) as Partial<ServerHub> | null;
    if (typeof body?.guildId !== 'number' || typeof body.userIds?.outsider !== 'number') {
        throw new Error(`[hubs-nav] server-hub seed: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, userIds: { outsider: body.userIds.outsider } };
}

async function seedCommunity(token: string, testInfo: TestInfo): Promise<CommunitySeed> {
    const gameId = await communityGameId(token, testInfo);
    const body = (await apiPost(token, '/admin/test/community-hubs/seed', { gameId })) as Partial<CommunitySeed> | null;
    if (!body?.hubIds || typeof body.gameId !== 'number' || !Array.isArray(body.memberUserIds)) {
        throw new Error(`[hubs-nav] community seed: ${JSON.stringify(body)}`);
    }
    return body as CommunitySeed;
}

async function myHubs(jwt: string): Promise<MyHub[]> {
    const body = (await apiGet(jwt, '/guilds/mine')) as { guilds?: MyHub[] } | null;
    return body?.guilds ?? [];
}

/** Seed both kinds, make the officer a server-hub member, sign them in, and wait for the API to list both. */
async function seedMember(page: Page, testInfo: TestInfo): Promise<Seed> {
    const token = await getAdminToken();
    const server = await seedServerHub(token, testInfo);
    const community = await seedCommunity(token, testInfo);
    const actorId = must(community.memberUserIds[0], 'officer id');
    await apiPost(token, '/admin/test/hub-member', { guildId: server.guildId, userId: actorId });
    const jwt = await signInOnboardedMember(page, actorId);
    const hubs = await pollForCondition(async () => {
        const mine = await myHubs(jwt);
        const ids = mine.map((h) => h.id);
        return ids.includes(server.guildId) && ids.includes(community.hubIds.crew) ? mine : null;
    }, { timeoutMs: 15_000, description: `user ${actorId} lists server hub ${server.guildId} + Seed Crew ${community.hubIds.crew}` });
    const serverHubName = must(hubs.find((h) => h.id === server.guildId)?.name, 'server hub name');
    return { serverHubId: server.guildId, serverHubName, crewId: community.hubIds.crew, gameId: community.gameId, actorId };
}

function rowFor(scope: Locator | Page, hubId: number): Locator {
    return scope.locator(`a[href="/guilds/${hubId}"]`);
}

async function openDrawer(page: Page): Promise<Locator> {
    await page.getByRole('button', { name: 'Open menu' }).click();
    const panel = page.getByTestId('more-drawer-panel');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    return panel;
}

/** The Filters entry, opened: the toolbar funnel's panel on desktop, else the FAB's sheet. */
async function openFilters(page: Page, testInfo: TestInfo): Promise<Locator> {
    if (isDesktop(testInfo)) {
        await page.getByTestId('filter-panel-trigger').click({ timeout: 15_000 });
        return page.getByTestId('filter-panel');
    }
    await page.getByTestId('filter-fab').click({ timeout: 15_000 });
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    return sheet;
}

async function expectHeaderMenu(page: Page, seed: Seed): Promise<void> {
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Guild', exact: true }), 'no "Guild" link in the header').toHaveCount(0);
    const trigger = nav.getByTestId('nav-hubs-menu-trigger');
    await expect(trigger, 'a hub member gets the Hubs menu from 768px').toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = page.getByRole('menu', { name: 'Hubs' });
    await expect(rowFor(menu, seed.serverHubId).getByTestId('hub-kind-chip'), 'the server row reads "Server"').toContainText('Server');
    await expect(rowFor(menu, seed.crewId).getByTestId('hub-kind-chip'), 'the community row reads "Community"').toContainText('Community');
    const items = menu.getByRole('menuitem');
    await expect(items.last(), '"Browse all hubs" is the last menu item').toHaveAttribute('data-testid', 'nav-hubs-browse-all');
    await expect(items.last()).toContainText('Browse all hubs');
    await items.last().click();
    await expect(menu, 'picking an item closes the menu').toHaveCount(0);
}

/** Phone (below 768px): the raised centre Hubs circle of the bottom bar opens "Your hubs" (operator ruling 2026-10-21). */
async function expectBottomHubs(page: Page, seed: Seed): Promise<void> {
    const bar = page.getByTestId('bottom-tab-bar');
    await expect(bar.getByTestId('bottom-tab-grid').locator(':scope > *').nth(2), 'Hubs is the middle of five slots').toHaveAttribute('aria-label', 'Hubs', { timeout: 15_000 });
    const trigger = bar.getByTestId('bottom-hubs-trigger');
    await expect(trigger, 'a hub member gets the Hubs sheet trigger').toHaveAttribute('aria-haspopup', 'dialog');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const sheet = page.getByRole('dialog', { name: 'Your hubs' });
    await expect(rowFor(sheet, seed.serverHubId).getByTestId('hub-kind-chip'), 'the server row reads "Server"').toContainText('Server');
    await expect(rowFor(sheet, seed.crewId).getByTestId('hub-kind-chip'), 'the community row reads "Community"').toContainText('Community');
    const browse = sheet.getByTestId('bottom-hubs-browse-all');
    await expect(browse).toContainText('Browse all hubs');
    await browse.click();
    await expect(trigger, 'Browse closes the sheet').toHaveAttribute('aria-expanded', 'false');
}

async function expectDrawerHubs(page: Page, seed: Seed): Promise<void> {
    const panel = await openDrawer(page);
    const block = panel.getByTestId('drawer-your-guild');
    await expect(block, 'the drawer opens with "Your hubs"').toContainText('Your hubs', { timeout: 15_000 });
    await expect(rowFor(block, seed.serverHubId).getByTestId('hub-kind-chip')).toContainText('Server');
    await expect(rowFor(block, seed.crewId).getByTestId('hub-kind-chip')).toContainText('Community');
    const browse = panel.getByTestId('drawer-hubs-link');
    await expect(browse).toContainText('Browse all hubs');
    await browse.click();
}

/** Tablet / landscape-phone widths where the full header row shows but `lg:` labels are collapsed. */
const NARROW_HEADER_VIEWPORTS = [{ width: 768, height: 1024 }, { width: 812, height: 375 }];

/** The header row fits its viewport: no sideways overflow, the user menu fully on screen, the brand on one line. */
async function expectHeaderFits(page: Page, viewport: { width: number; height: number }): Promise<void> {
    const label = `${viewport.width}x${viewport.height}`;
    const row = page.locator('header > div').first();
    const fit = await row.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(fit.scroll, `${label}: header row scrollWidth ${fit.scroll} must be <= clientWidth ${fit.client}`).toBeLessThanOrEqual(fit.client);
    const box = must(await page.getByTestId('user-menu-trigger').boundingBox(), `${label} user-menu box`);
    expect(box.x, `${label}: the user menu starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${label}: the user menu's right edge ${box.x + box.width} must sit inside the ${viewport.width}px viewport`).toBeLessThanOrEqual(viewport.width);
    const brand = must(await page.getByTestId('header-brand').boundingBox(), `${label} brand box`);
    expect(brand.height, `${label}: the brand must stay on one line (height ${brand.height})`).toBeLessThanOrEqual(40);
}

test.describe('Hubs nav (ROK-1875)', () => {
    test('a member of a server + a community hub: Hubs menu (≥768px) / bottom Hubs sheet + More drawer (phone) list both with kind chips, then Browse all hubs', async ({ page }, testInfo) => {
        const seed = await seedMember(page, testInfo);
        await page.goto('/calendar');
        const width = page.viewportSize()?.width ?? 0;
        if (width >= HEADER_HUBS_MIN_WIDTH) await expectHeaderMenu(page, seed);
        else {
            await expectBottomHubs(page, seed);
            await expect(page).toHaveURL(/\/hubs(?:[?#]|$)/);
            // The More drawer keeps its "Your hubs" block (discoverability) beside the bottom button.
            await page.goto('/calendar');
            await expectDrawerHubs(page, seed);
        }
        await expect(page).toHaveURL(/\/hubs(?:[?#]|$)/);
        await expect(page.getByRole('heading', { name: 'Hubs', level: 1 })).toBeVisible({ timeout: 15_000 });
    });

    test('768–1023px: with the Hubs menu trigger the header row fits — no overflow, user menu on screen, one-line brand', async ({ page }, testInfo) => {
        await seedMember(page, testInfo);
        for (const viewport of NARROW_HEADER_VIEWPORTS) {
            await page.setViewportSize(viewport);
            await page.goto('/calendar');
            await expect(page.getByTestId('nav-hubs-menu-trigger'), 'the widest case: a hub member gets the menu trigger').toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('user-menu-trigger')).toBeVisible({ timeout: 15_000 });
            await expectHeaderFits(page, viewport);
        }
    });

    test('a viewer in no hubs gets a plain Hubs link to /hubs, no menu', async ({ page }, testInfo) => {
        const server = await seedServerHub(await getAdminToken(), testInfo);
        const outsiderJwt = await signInOnboardedMember(page, server.userIds.outsider);
        expect(await myHubs(outsiderJwt), 'the outsider is in no hub').toEqual([]);
        await page.goto('/calendar');
        const width = page.viewportSize()?.width ?? 0;
        if (width >= HEADER_HUBS_MIN_WIDTH) {
            const nav = page.getByRole('navigation', { name: 'Main navigation' });
            const link = nav.getByTestId('nav-hubs-link');
            await expect(link, 'no hubs → a plain link').toHaveAttribute('href', '/hubs', { timeout: 15_000 });
            await expect(nav.getByTestId('nav-hubs-menu-trigger'), 'no hubs → no menu trigger').toHaveCount(0);
            await link.click();
        } else {
            const bottom = page.getByTestId('bottom-tab-bar').getByTestId('bottom-hubs-link');
            await expect(bottom, 'no hubs → the bottom Hubs circle is a plain link').toHaveAttribute('href', '/hubs', { timeout: 15_000 });
            await expect(page.getByTestId('bottom-hubs-trigger'), 'no hubs → no sheet trigger').toHaveCount(0);
            const panel = await openDrawer(page);
            await expect(panel.getByTestId('drawer-hubs-link')).toBeVisible({ timeout: 15_000 });
            await expect(panel.getByTestId('drawer-your-guild'), 'no hubs → no "Your hubs" block').toHaveCount(0);
            await panel.getByTestId('drawer-hubs-link').click();
        }
        await expect(page).toHaveURL(/\/hubs(?:[?#]|$)/);
    });

    test('/hubs: the server card shows View (no Join) and opens the hub; a community card keeps Join', async ({ page }) => {
        const seed = await seedMember(page, test.info());
        const cards = page.getByTestId('hub-directory-card');
        await page.goto(`/hubs?game=${seed.gameId}&kind=community`);
        const solo = cards.filter({ hasText: 'Seed Solo' });
        await expect(solo.getByTestId('hub-kind-chip'), 'the community card reads "Community"').toContainText('Community', { timeout: 20_000 });
        await expect(solo.getByRole('button', { name: 'Join Seed Solo' }), 'a community card keeps Join').toBeVisible();

        await page.goto(`/hubs?kind=server&q=${encodeURIComponent(seed.serverHubName)}`);
        const server = cards.filter({ has: rowFor(page, seed.serverHubId) });
        await expect(server.getByTestId('hub-kind-chip'), 'the server card reads "Server"').toContainText('Server', { timeout: 20_000 });
        await expect(server.getByRole('button', { name: /^Join / }), 'a server card has no Join').toHaveCount(0);
        await server.getByRole('link', { name: `View ${seed.serverHubName}` }).click();
        await expect(page).toHaveURL(new RegExp(`/guilds/${seed.serverHubId}(?:[?#]|$)`));
        await expect(page.getByTestId('server-hub-status'), 'View opens the server hub page').toBeVisible({ timeout: 15_000 });
    });

    test('/hubs Kind filter: Server narrows a mixed joined list to server hubs and writes ?kind=server', async ({ page }, testInfo) => {
        const seed = await seedMember(page, testInfo);
        const cards = page.getByTestId('hub-directory-card');
        await page.goto('/hubs?membership=joined');
        const crew = cards.filter({ has: rowFor(page, seed.crewId) });
        const server = cards.filter({ has: rowFor(page, seed.serverHubId) });
        await expect(crew, 'the mixed list has the community hub').toHaveCount(1, { timeout: 20_000 });
        await expect(server, 'the mixed list has the server hub').toHaveCount(1);

        const filters = await openFilters(page, testInfo);
        await filters.getByRole('radio', { name: 'Server', exact: true }).check();
        await expect(page).toHaveURL(/[?&]kind=server(?:&|$)/, { timeout: 15_000 });
        await expect(crew, 'Kind = Server drops the community hub').toHaveCount(0, { timeout: 15_000 });
        await expect(server, 'Kind = Server keeps the server hub').toHaveCount(1);
        // Scoped to the directory cards: the Hubs nav menu also renders kind chips (one per joined hub).
        await expect(cards.getByTestId('hub-kind-chip').filter({ hasNotText: 'Server' }), 'every card left is a server hub').toHaveCount(0);
        await expect(cards.getByTestId('hub-kind-chip').filter({ hasText: 'Server' }).first(), 'the remaining cards carry the Server chip').toBeVisible();
    });
});
