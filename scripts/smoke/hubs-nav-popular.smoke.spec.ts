/**
 * ROK-2152 — the Hubs menu (≥768px) / bottom Hubs sheet (phone) also lists up to 5
 * "Popular hubs": the viewer's `/hubs` directory read (`membership=not-joined`,
 * `sort=members`, `limit=10`) minus banned / staff-hidden / already-mine rows, server
 * order kept. Desktop, mobile AND tablet (the branch is the viewport width).
 *
 * The popular set is instance-wide and other specs seed hubs in parallel, so nothing
 * here asserts fixed names or ranks: test 1 compares the rows with the very
 * `GET /hubs` answer the page received (captured off the wire). Test 2 needs a hub it
 * owns to sit in the list, so it prepends this tag's `Seed Solo` to that same real
 * answer while the API still reports the viewer outside it (`GET /hubs/by-game`); the
 * Join then has to drop it through the server read + the `['hubs-directory']`
 * invalidation alone.
 *
 * Seed, per test: `POST /admin/test/community-hubs/seed` with this spec's tag
 * (`./hub-seed`, ROK-2030) on a configured game → `Seed Crew #<tag>` (officer in it,
 * `community-banned` banned from it) and `Seed Solo #<tag>` (officer not in it).
 * Membership writes are confirmed by polling the API with the viewer's own JWT
 * (memory `feedback_smoke_polling_for_async_writes`).
 */
import type { Locator, Page, Response, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, getAdminToken, pollForCondition } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';

interface Entry { id: number; viewer: string; hidden?: boolean }
interface DirectoryPage { items: Entry[] }
interface CommunitySeed { gameId: number; hubIds: { crew: number; solo: number }; memberUserIds: number[]; bannedUserId: number }

/** Header `md:` — from 768px the header carries the Hubs menu; below it the bottom bar's sheet. */
const HEADER_HUBS_MIN_WIDTH = 768;
const POPULAR_SHOWN = 5;
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };
/** `/players` never scrolls itself (a scroll hides the phone bars — see hubs-nav.smoke). */
const NAV_START = '/players';

function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hubs-nav-popular] missing ${label}`);
    return value;
}

async function communityGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[hubs-nav-popular] GET /games/configured returned no games');
    return must(ids[(5 + (PROJECT_SLOT[testInfo.project.name] ?? 0)) % ids.length], 'community game id');
}

async function seedHubs(testInfo: TestInfo): Promise<CommunitySeed> {
    const token = await getAdminToken();
    const gameId = await communityGameId(token, testInfo);
    const body = (await seedCommunityHubs(token, testInfo, 'hubs-nav-popular', { gameId })) as Partial<CommunitySeed> | null;
    if (!body?.hubIds || typeof body.gameId !== 'number' || !Array.isArray(body.memberUserIds) || typeof body.bannedUserId !== 'number') {
        throw new Error(`[hubs-nav-popular] community seed: ${JSON.stringify(body)}`);
    }
    return body as CommunitySeed;
}

async function mineIds(jwt: string): Promise<number[]> {
    const body = (await apiGet(jwt, '/guilds/mine')) as { guilds?: { id: number }[] } | null;
    return (body?.guilds ?? []).map((g) => g.id);
}

/** The officer, signed in, once `GET /guilds/mine` lists Seed Crew. */
async function signInOfficer(page: Page, seed: CommunitySeed): Promise<{ jwt: string; mine: number[] }> {
    const jwt = await signInOnboardedMember(page, must(seed.memberUserIds[0], 'officer id'));
    const mine = await pollForCondition(async () => {
        const ids = await mineIds(jwt);
        return ids.includes(seed.hubIds.crew) ? ids : null;
    }, { timeoutMs: 15_000, description: `officer lists Seed Crew ${seed.hubIds.crew}` });
    return { jwt, mine };
}

function isPopularRead(raw: string): boolean {
    const url = new URL(raw);
    return url.pathname.endsWith('/hubs') && url.searchParams.get('membership') === 'not-joined' && url.searchParams.get('sort') === 'members';
}

/** Loads NAV_START and returns its popular read; `about:blank` first drops any read still in flight from sign-in. */
async function loadWithPopularRead(page: Page): Promise<Response> {
    await page.goto('about:blank');
    const read = page.waitForResponse((r) => r.request().method() === 'GET' && isPopularRead(r.url()), { timeout: 20_000 });
    await page.goto(NAV_START);
    return read;
}

/** The client rule (`selectPopularHubs`), applied to a real `GET /hubs` answer. */
async function expectedPopular(res: Response, mine: number[]): Promise<number[]> {
    expect(new URL(res.url()).searchParams.get('limit'), 'the nav over-fetches 10').toBe('10');
    const body = (await res.json()) as DirectoryPage;
    return body.items
        .filter((h) => h.viewer !== 'banned' && h.hidden !== true && !mine.includes(h.id))
        .slice(0, POPULAR_SHOWN)
        .map((h) => h.id);
}

/** Opens the header Hubs menu (≥768px) or the bottom Hubs sheet (phone) and returns it. */
async function openHubsNav(page: Page): Promise<Locator> {
    if ((page.viewportSize()?.width ?? 0) >= HEADER_HUBS_MIN_WIDTH) {
        const trigger = page.getByRole('navigation', { name: 'Main navigation' }).getByTestId('nav-hubs-menu-trigger');
        await expect(trigger, 'the Hubs menu trigger').toBeVisible({ timeout: 15_000 });
        await trigger.click();
        const menu = page.getByRole('menu', { name: 'Hubs' });
        await expect(menu).toBeVisible({ timeout: 5_000 });
        return menu;
    }
    const trigger = page.getByTestId('bottom-tab-bar').getByTestId('bottom-hubs-trigger');
    await expect(trigger, 'the bottom Hubs sheet trigger').toHaveAttribute('aria-haspopup', 'dialog', { timeout: 15_000 });
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'Your hubs' });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    return sheet;
}

async function closeHubsNav(page: Page, scope: Locator): Promise<void> {
    await page.keyboard.press('Escape');
    await expect(scope, 'Escape closes the hubs menu / sheet').toBeHidden({ timeout: 5_000 });
}

function popularIds(scope: Locator): Promise<number[]> {
    return scope.getByTestId('popular-hub-row').evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-hub-id'))));
}

function popularRow(scope: Locator, hubId: number): Locator {
    return scope.locator(`[data-testid="popular-hub-row"][data-hub-id="${hubId}"]`);
}

function ownRow(scope: Locator, hubId: number): Locator {
    return scope.locator(`a[data-testid="guild-entry-row"][href="/hubs/${hubId}"]`);
}

/** True when the "Popular hubs" heading follows every "Your hubs" row in document order. */
function headingAfterOwnRows(scope: Locator): Promise<boolean> {
    return scope.evaluate((root) => {
        const head = root.querySelector('[data-testid="popular-hubs-heading"]');
        const own = Array.from(root.querySelectorAll('[data-testid="guild-entry-row"]'));
        return head !== null && own.length > 0 && own.every((row) => (row.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    });
}

async function viewerOf(jwt: string, gameId: number, hubId: number): Promise<Entry | undefined> {
    const body = (await apiGet(jwt, `/hubs/by-game/${gameId}`)) as { hubs?: Entry[] } | null;
    return body?.hubs?.find((h) => h.id === hubId);
}

/** Prepends Seed Solo to the real popular answer while the API still has the viewer outside it. */
async function pinSoloWhileNotJoined(page: Page, jwt: string, seed: CommunitySeed): Promise<void> {
    await page.route((url) => isPopularRead(url.href), async (route) => {
        const res = await route.fetch();
        const body = (await res.json()) as DirectoryPage & Record<string, unknown>;
        const solo = await viewerOf(jwt, seed.gameId, seed.hubIds.solo);
        const pinned = solo && solo.viewer === 'not-member' ? [solo] : [];
        const items = [...pinned, ...body.items.filter((h) => h.id !== seed.hubIds.solo)];
        await route.fulfill({ response: res, json: { ...body, items } });
    });
}

test.describe('Hubs nav — Popular hubs (ROK-2152)', () => {
    test('a hub member: "Popular hubs" follows "Your hubs", matches the API read, and a row opens the hub', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const { mine } = await signInOfficer(page, seed);
        const expected = await expectedPopular(await loadWithPopularRead(page), mine);
        expect(expected.length, 'the instance has at least one visible hub the officer is not in (Seed Solo)').toBeGreaterThan(0);
        expect(expected, 'a hub the viewer is in is never suggested').not.toContain(seed.hubIds.crew);

        const scope = await openHubsNav(page);
        await expect(ownRow(scope, seed.hubIds.crew), '"Your hubs" lists Seed Crew').toHaveCount(1, { timeout: 15_000 });
        await expect(scope.getByTestId('popular-hubs-heading'), 'the section heading').toHaveText('Popular hubs');
        await expect.poll(() => popularIds(scope), { message: 'popular rows = the API read minus banned/hidden/mine, first 5, in order', timeout: 15_000 }).toEqual(expected);
        expect(await headingAfterOwnRows(scope), '"Popular hubs" sits under the "Your hubs" rows').toBe(true);

        const first = must(expected[0], 'first popular id');
        await popularRow(scope, first).click();
        await expect(page, 'a popular row opens its hub page').toHaveURL(new RegExp(`/hubs/${first}(?:[?#]|$)`));
        await expect(scope, 'picking a popular row closes the menu / sheet').toBeHidden({ timeout: 5_000 });
    });

    test('joining a suggested hub moves it from "Popular hubs" to "Your hubs"', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const { jwt } = await signInOfficer(page, seed);
        expect((await viewerOf(jwt, seed.gameId, seed.hubIds.solo))?.viewer, 'the officer starts outside Seed Solo').toBe('not-member');
        let joined = false;
        try {
            await pinSoloWhileNotJoined(page, jwt, seed);
            await page.goto(NAV_START);
            let scope = await openHubsNav(page);
            await expect(popularRow(scope, seed.hubIds.solo), 'Seed Solo is suggested before the Join').toHaveCount(1, { timeout: 15_000 });
            await expect(ownRow(scope, seed.hubIds.solo), 'and is not under "Your hubs"').toHaveCount(0);
            await closeHubsNav(page, scope);

            await page.goto(`/hubs/${seed.hubIds.solo}`);
            await page.getByTestId('community-hub-join').click({ timeout: 20_000 });
            joined = true;
            await expect.poll(async () => (await viewerOf(jwt, seed.gameId, seed.hubIds.solo))?.viewer, { message: 'Join must reach the API', timeout: 15_000 }).toBe('member');
            await expect(page.getByTestId('community-hub-leave'), 'the hero flipped to Leave').toBeVisible({ timeout: 15_000 });

            scope = await openHubsNav(page);
            await expect(ownRow(scope, seed.hubIds.solo), 'after the Join Seed Solo is under "Your hubs"').toHaveCount(1, { timeout: 15_000 });
            await expect(popularRow(scope, seed.hubIds.solo), 'and no longer suggested').toHaveCount(0, { timeout: 15_000 });
        } finally {
            await page.unrouteAll({ behavior: 'ignoreErrors' });
            if (joined) await apiDelete(jwt, `/hubs/${seed.hubIds.solo}/join`);
        }
    });

    test('a viewer in no hub (Q1): the menu / sheet opens with only "Popular hubs", banned hubs left out', async ({ page }, testInfo) => {
        const seed = await seedHubs(testInfo);
        const jwt = await signInOnboardedMember(page, seed.bannedUserId);
        expect(await mineIds(jwt), 'community-banned is in no hub').toEqual([]);
        const expected = await expectedPopular(await loadWithPopularRead(page), []);
        expect(expected.length, 'at least Seed Solo is suggested').toBeGreaterThan(0);

        const scope = await openHubsNav(page);
        await expect.poll(() => popularIds(scope), { message: 'popular rows = the API read minus banned/hidden, first 5', timeout: 15_000 }).toEqual(expected);
        await expect(scope.getByTestId('guild-entry-row'), 'no "Your hubs" rows').toHaveCount(0);
        await expect(popularRow(scope, seed.hubIds.crew), 'the hub the viewer is banned from is never suggested').toHaveCount(0);
    });
});
