/**
 * ROK-1953 — the shared Core Steam cards (Achievement race + Playtime) on a
 * BG3-app-id community hub, desktop AND mobile.
 *
 * Seed (DEMO_MODE, as admin): `POST /admin/test/steam-app-stats/seed {}` →
 * its OWN hub "Steam Stats Crew" `<H>` on its OWN disabled game holding BG3's
 * app id (review R1: never in `/games/configured`, so no other hub spec's
 * game picker can land on it, and no shared game row is mutated) → roles A..D =
 * `community-member-1..4`: A `ok` 5/6 incl. both hidden achievements, B `ok`
 * 3/6, C `private`, D unlinked. Every test here is READ-ONLY, so the projects
 * share ONE seed: it runs under a cross-worker file lock and is reused while
 * the API still reports the seeded shape (two concurrent seeds would delete and
 * re-insert the same users' rows under each other). The "game not enabled"
 * hub is a community-hubs seed on a configured non-BG3 game picked by
 * `9 + testInfo.parallelIndex` (community-hubs takes indexes 0–2, hubs-nav
 * 3–5, hub-invite/hub-poll 6–8), so each worker owns its game.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiGet, apiPost, getAdminToken, getInviteeFixture, pollForCondition } from './api-helpers';
import { seedCommunityHubs } from './hub-seed';
import { signInOnboardedMember } from './browser-session';

type Role = 'a' | 'b' | 'c' | 'd';

interface SteamSeed {
    hubId: number;
    gameId: number;
    users: Record<Role, { userId: number; username: string }>;
}

interface StatsMember {
    displayName: string;
    status: string;
    unlockedCount: number | null;
}

interface StatsBody {
    available: boolean;
    totalAchievements?: number;
    members?: StatsMember[];
}

const ACHIEVEMENTS_CELL = '#hub-widget-core-steam-achievements';
const PLAYTIME_CELL = '#hub-widget-core-steam-playtime';
const HIDDEN_NAMES = /Demo Secret (Ending|Romance)/;
const NON_ENABLED_GAME_OFFSET = 9;
const LOCK_DIR = join(tmpdir(), `rl-smoke-hub-steam-stats-${Buffer.from(API_BASE).toString('hex').slice(-24)}`);
const CACHE_FILE = `${LOCK_DIR}.json`;
const STALE_LOCK_MS = 120_000;

/** Fail loudly on a missing value (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[hub-steam-stats] missing ${label}`);
    return value;
}

/** `mkdir` is atomic: the worker that creates the dir holds the lock. A crashed holder's dir goes stale. */
async function tryLock(): Promise<boolean> {
    try {
        await mkdir(LOCK_DIR);
        return true;
    } catch {
        const age = await stat(LOCK_DIR).then((s) => Date.now() - s.mtimeMs, () => 0);
        if (age > STALE_LOCK_MS) await rm(LOCK_DIR, { recursive: true, force: true });
        return false;
    }
}

async function withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
    await pollForCondition(() => tryLock().then((ok) => (ok ? true : null)), {
        timeoutMs: 90_000,
        description: 'the cross-worker steam-stats seed lock',
    });
    try {
        return await fn();
    } finally {
        await rm(LOCK_DIR, { recursive: true, force: true });
    }
}

async function hubStats(jwt: string, hubId: number): Promise<StatsBody | null> {
    return (await apiGet(jwt, `/hubs/${hubId}/steam-stats`)) as StatsBody | null;
}

/** True when the API still serves the seeded fixture for `seed` (staff read — admin passes the gate). */
async function seedIsLive(admin: string, seed: SteamSeed): Promise<boolean> {
    const body = await hubStats(admin, seed.hubId);
    const count = (role: Role): number | null | undefined =>
        body?.members?.find((m) => m.displayName === seed.users[role].username)?.unlockedCount;
    return body?.available === true && body.totalAchievements === 6 && count('a') === 5 && count('b') === 3;
}

async function readCachedSeed(): Promise<SteamSeed | null> {
    const raw = await readFile(CACHE_FILE, 'utf8').catch(() => null);
    return raw ? (JSON.parse(raw) as SteamSeed) : null;
}

async function seedFresh(admin: string): Promise<SteamSeed> {
    const steam = (await apiPost(admin, '/admin/test/steam-app-stats/seed', {})) as
        | (Partial<SteamSeed> & { guildId?: number })
        | null;
    if (!steam || typeof steam.guildId !== 'number' || typeof steam.gameId !== 'number' || !steam.users) {
        throw new Error(`[hub-steam-stats] steam seed: ${JSON.stringify(steam)}`);
    }
    const hubId = steam.guildId;
    const seed: SteamSeed = { hubId, gameId: steam.gameId, users: steam.users };
    await pollForCondition(() => seedIsLive(admin, seed).then((ok) => (ok ? true : null)), {
        timeoutMs: 30_000,
        description: `GET /hubs/${hubId}/steam-stats serves the seeded race`,
    });
    await writeFile(CACHE_FILE, JSON.stringify(seed));
    return seed;
}

let seedPromise: Promise<SteamSeed> | null = null;

/** The shared BG3 Steam fixture: reused while live, else re-seeded once under the lock. */
function steamSeed(): Promise<SteamSeed> {
    seedPromise ??= (async () => {
        const admin = await getAdminToken();
        return withSeedLock(async () => {
            const cached = await readCachedSeed();
            if (cached && (await seedIsLive(admin, cached))) return cached;
            return seedFresh(admin);
        });
    })();
    return seedPromise;
}

/** A configured non-BG3 game this worker owns; its "Seed Crew" has B as a member. */
async function nonEnabledHub(bg3GameId: number, testInfo: TestInfo): Promise<number> {
    const admin = await getAdminToken();
    const body = (await apiGet(admin, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number' && id !== bg3GameId)
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[hub-steam-stats] no configured non-BG3 game');
    const gameId = must(ids[(NON_ENABLED_GAME_OFFSET + testInfo.parallelIndex) % ids.length], 'non-enabled game');
    const seed = (await seedCommunityHubs(admin, testInfo, 'hub-steam-stats', { gameId })) as { hubIds?: { crew?: number } } | null;
    const hubId = must(seed?.hubIds?.crew, `non-enabled seed: ${JSON.stringify(seed)}`);
    await pollForCondition(() => hubStats(admin, hubId).then((s) => (s?.available === false ? true : null)), {
        timeoutMs: 30_000,
        description: `GET /hubs/${hubId}/steam-stats answers { available: false }`,
    });
    return hubId;
}

/** Sign in as `role`, open the hub and wait for both cards' bodies (the cells mount only once visible). */
async function openCards(page: Page, seed: SteamSeed, role: Role): Promise<{ race: Locator; playtime: Locator }> {
    await signInOnboardedMember(page, seed.users[role].userId);
    await page.goto(`/hubs/${seed.hubId}`);
    const race = page.locator(ACHIEVEMENTS_CELL);
    const playtime = page.locator(PLAYTIME_CELL);
    await expect(race.getByTestId('steam-achievements-body'), 'the Achievement race card renders').toBeVisible({ timeout: 20_000 });
    await expect(playtime.getByTestId('steam-playtime-body'), 'the Playtime card renders').toBeVisible({ timeout: 20_000 });
    return { race, playtime };
}

function raceRow(card: Locator, username: string): Locator {
    return card.getByTestId('steam-race-row').filter({ hasText: username });
}

test.describe('hub Steam cards — member', () => {
    test('B sees both cards: X / Y race, recent unlocks, hours; A\'s hidden unlocks are masked with their %', async ({ page }) => {
        const seed = await steamSeed();
        const { race, playtime } = await openCards(page, seed, 'b');

        await expect(raceRow(race, seed.users.a.username), 'A leads the race').toContainText('5 / 6');
        await expect(raceRow(race, seed.users.b.username), 'B is on the race').toContainText('3 / 6');
        await expect(raceRow(race, seed.users.d.username), 'an unlinked member is off the race').toHaveCount(0);
        const unlocks = race.getByTestId('steam-unlock-row');
        await expect(unlocks.first(), 'recent unlocks are listed').toBeVisible();
        expect(await unlocks.count(), 'the card shows at most 4 recent unlocks').toBeLessThanOrEqual(4);

        const masked = race.getByTestId('steam-masked-achievement');
        await expect(masked.first(), 'A\'s hidden unlock is masked for B').toHaveText('Hidden achievement');
        await expect(race.getByTestId('steam-rarest'), 'the rarest unlock is masked but keeps its %').toContainText(
            /Rarest: Hidden achievement · 2\.7%/,
        );
        await expect(page.locator('body'), 'no hidden achievement name reaches B').not.toContainText(HIDDEN_NAMES);

        await expect(playtime.getByTestId('steam-playtime-row').first(), 'playtime rows are listed').toBeVisible();
        await expect(playtime.getByTestId('steam-playtime-row').filter({ hasText: seed.users.a.username }), 'A: 7260 min').toContainText(
            /121/,
        );
        await expect(playtime.getByTestId('steam-playtime-row').filter({ hasText: seed.users.b.username }), 'B: 2400 min').toContainText(
            /40/,
        );
    });

    test('A, who unlocked the hidden achievements, sees their real names', async ({ page }) => {
        const seed = await steamSeed();
        const { race } = await openCards(page, seed, 'a');
        await expect(race.getByTestId('steam-rarest'), 'A\'s own rarest unlock is named').toContainText('Demo Secret Ending');
        await expect(race.getByTestId('steam-masked-achievement'), 'nothing is masked for its owner').toHaveCount(0);
    });

    test('C (private profile) gets the warning-tone private line and no Link Steam button', async ({ page }) => {
        const seed = await steamSeed();
        const { race } = await openCards(page, seed, 'c');
        const callout = race.getByTestId('steam-stats-callout');
        await expect(callout, 'the private viewer line').toBeVisible();
        await expect(callout).toHaveClass(/text-warning/);
        await expect(race.getByTestId('steam-stats-link'), 'a private viewer gets no Link Steam button').toHaveCount(0);
        await expect(raceRow(race, seed.users.c.username), 'a private member is off the race').toHaveCount(0);
    });

    test('D (unlinked) is prompted to link Steam', async ({ page }) => {
        const seed = await steamSeed();
        const { race } = await openCards(page, seed, 'd');
        await expect(race.getByTestId('steam-stats-callout'), 'the unlinked viewer prompt').toContainText('Link Steam to join the race.');
        await expect(race.getByRole('button', { name: 'Link Steam' }), 'the Link Steam button').toBeVisible();
    });
});

test.describe('hub Steam cards — hidden', () => {
    test('a non-member of the BG3 hub sees neither card', async ({ page }) => {
        const seed = await steamSeed();
        const outsider = await getInviteeFixture();
        expect(Object.values(seed.users).map((u) => u.userId), 'the invitee is not a seeded member').not.toContain(outsider.userId);
        await signInOnboardedMember(page, outsider.userId);
        await page.goto(`/hubs/${seed.hubId}`);
        await expect(page.getByTestId('community-hub-kind'), 'the hub page renders').toBeVisible({ timeout: 20_000 });
        await expect(page.locator(ACHIEVEMENTS_CELL), 'no Achievement race for a non-member').toHaveCount(0);
        await expect(page.locator(PLAYTIME_CELL), 'no Playtime card for a non-member').toHaveCount(0);
    });

    test('a hub whose game is not enabled shows neither card to a member', async ({ page }, testInfo) => {
        const seed = await steamSeed();
        const hubId = await nonEnabledHub(seed.gameId, testInfo);
        await signInOnboardedMember(page, seed.users.b.userId);
        // The member Overview always fires the probe (D9), so wait for its answer before asserting absence.
        const probe = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/hubs/${hubId}/steam-stats`), {
            timeout: 20_000,
        });
        await page.goto(`/hubs/${hubId}`);
        expect(await (await probe).json(), 'the probe reports the game as not enabled').toEqual({ available: false });
        await expect(page.getByTestId('community-hub-kind'), 'the hub page renders').toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('community-hub-leave'), 'B is a member of this hub').toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[id^="hub-widget-core-steam-"]'), 'no Core Steam cell on a non-enabled game').toHaveCount(0);
    });
});
