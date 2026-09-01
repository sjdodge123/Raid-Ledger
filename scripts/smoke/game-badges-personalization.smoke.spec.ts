/**
 * ROK-1314 — universal game badges + "You own" / "You wishlisted" (AC1/2/4/9).
 *
 * Two seeded viewers, ONE game, three different badge states:
 *
 *   admin    game_interests.source = 'steam_library'   -> "You own"        + "N own"
 *   invitee  game_interests.source = 'steam_wishlist'  -> "You wishlisted" + "N wishlisted"
 *   anon     no viewer                                 -> neither pill, aggregates intact
 *
 * Surfaces driven:
 *   • /games                     — the Game Library page  (AC9)
 *   • /community-lineup/:id      — the Common Ground tile (AC1 / AC2)
 *   • unauthenticated GET /games/:id — the anonymous contract (AC4). The SPA's
 *     /games route sits behind AuthGuard, so the browser can never render an
 *     anonymous Library page; the boundary that IS anonymous is the unguarded
 *     GameDetailDto endpoint, and that is where AC4 is proven. The browser half
 *     of AC4 is the invitee: a logged-in viewer who does NOT own the game must
 *     never see "You own" on the very card that shows it to the admin.
 *
 * Runs in BOTH the `desktop` and `mobile` projects (playwright.config.ts) —
 * never narrowed with --project, per CLAUDE.md "Smoke Test Verification".
 *
 * ─── FIXTURE DEPENDENCY THE DEV MUST BUILD ──────────────────────────────────
 * `POST /admin/test/add-game-interest` currently hardcodes `source: 'manual'`
 * (`api/src/admin/demo-test-steam.helpers.ts::addGameInterestForTest`), and a
 * `manual` heart is explicitly NOT ownership (spec §2 decision 4). This spec
 * posts an optional `source` and asserts the seeded state through the API
 * BEFORE touching the UI, so the missing parameter surfaces as a clear
 * fixture-assertion failure rather than a mystery empty badge row.
 * Extend `AddGameInterestSchema` + `addGameInterestForTest` with an optional
 * `source` (default 'manual', so existing callers are unaffected).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * TDD: written before the implementation. Every badge assertion below fails on
 * the pre-implementation tree.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import {
    getAdminToken,
    getInviteeFixture,
    apiGet,
    apiPost,
    createLineupOrRetry,
    pollForCondition,
    API_BASE,
} from './api-helpers';

const FILE_PREFIX = 'game-badges-personalization';
const HOOK_TIMEOUT_MS = 90_000;

let workerPrefix: string;
let adminToken: string;
let adminUserId: number;
let inviteeToken: string;
let inviteeUserId: number;
let lineupId: number;
let gameId: number;
let gameName: string;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Pick the fixture game OUT OF the common-ground result set rather than out of
 * the raw games table. `/lineups/common-ground` is an ownership-overlap query:
 * a game nobody has any interest row for is absent from the response entirely,
 * even at `minOwners=0`. Sourcing the fixture from the endpoint itself
 * guarantees the game is reachable on BOTH surfaces this spec drives.
 */
async function pickGame(token: string): Promise<{ id: number; name: string }> {
    const res = await apiGet(token, '/lineups/common-ground?minOwners=1');
    const first = res?.data?.[0] as
        | { gameId: number; gameName: string }
        | undefined;
    if (!first) {
        throw new Error(
            'common-ground returned no rows — demo seed ownership data missing',
        );
    }
    return { id: first.gameId, name: first.gameName };
}

/**
 * Seed a typed game interest. `source` is the field the dev must add to
 * `AddGameInterestSchema` — see the header note.
 */
async function seedInterest(
    userId: number,
    id: number,
    source: 'steam_library' | 'steam_wishlist',
): Promise<void> {
    await apiPost(adminToken, '/admin/test/clear-game-interest', {
        userId,
        gameId: id,
    });
    await apiPost(adminToken, '/admin/test/add-game-interest', {
        userId,
        gameId: id,
        source,
    });
}

/**
 * Swap the browser session to another user by overwriting the auth token in
 * localStorage (same key `use-auth.ts` reads). Mirrors the helper in
 * `lineup-confirmation-pills-invitee.smoke.spec.ts`.
 */
async function loginAs(page: Page, token: string): Promise<void> {
    await page.goto('/');
    await page.evaluate((t) => {
        localStorage.setItem('raid_ledger_token', t);
    }, token);
}

/**
 * Search the Library page down to the single fixture game and wait for its
 * card. Assertions that follow are PAGE-scoped rather than card-scoped on
 * purpose: this story restructures the card DOM (spec §5.5 extracts
 * `unified-game-card.tsx` before adding the row), so pinning a wrapper element
 * would test the implementation instead of the behaviour. The search narrows
 * the result set to the fixture game, which is what makes page scope honest.
 */
async function openLibraryFor(page: Page): Promise<void> {
    await page.goto('/games');
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 15_000,
    });
    await page.getByPlaceholder('Search games...').fill(gameName);
    const card = page.locator(`a[href="/games/${gameId}"]:visible`).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
}

/** Navigate to the Nominating composite and search for the fixture game. */
async function commonGroundTile(page: Page) {
    await page.goto(`/community-lineup/${lineupId}`);
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 15_000,
    });
    const searchBtn = page.getByTestId('sticky-hero-search');
    await expect(searchBtn).toBeVisible({ timeout: 20_000 });
    await searchBtn.click();
    const box = page.getByRole('searchbox', { name: /search games/i });
    await expect(box).toBeVisible({ timeout: 10_000 });
    await box.fill(gameName);
    const tile = page
        .getByTestId('common-ground-tile')
        .filter({ hasText: gameName })
        .first();
    await expect(tile).toBeVisible({ timeout: 20_000 });
    return tile;
}

test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    adminToken = await getAdminToken();

    const me = (await apiGet(adminToken, '/auth/me')) as { id: number };
    adminUserId = me.id;
    const invitee = await getInviteeFixture();
    inviteeToken = invitee.jwt;
    inviteeUserId = invitee.userId;

    const game = await pickGame(adminToken);
    gameId = game.id;
    gameName = game.name;

    await seedInterest(adminUserId, gameId, 'steam_library');
    await seedInterest(inviteeUserId, gameId, 'steam_wishlist');

    await apiPost(adminToken, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
    const { id } = await createLineupOrRetry(
        adminToken,
        {
            title: `${workerPrefix}Badge Personalization`,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );
    lineupId = id;
});

// ---------------------------------------------------------------------------
// Fixture gate — deliberately a TEST, not a beforeAll throw
//
// A failing beforeAll aborts the whole file, so one missing fixture parameter
// would mask the other 15 assertions and the dev would fix them one round-trip
// at a time. As a test it reports the fixture gap explicitly while every UI
// assertion below still runs and fails on its own merits.
// ---------------------------------------------------------------------------

test('fixture: the seeded steam_library interest reaches the common-ground row', async () => {
    await pollForCondition(
        async () => {
            const res = await apiGet(
                adminToken,
                `/lineups/common-ground?minOwners=0&search=${encodeURIComponent(
                    gameName,
                )}&lineupId=${lineupId}`,
            );
            const row = (
                res?.data as
                    | { gameId: number; ownerCount: number; currentUserOwns?: boolean }[]
                    | undefined
            )?.find((g) => g.gameId === gameId);
            return row?.currentUserOwns === true ? row : null;
        },
        {
            timeoutMs: 20_000,
            description:
                'common-ground row reports currentUserOwns=true for the admin ' +
                '(needs the optional interest-source param on ' +
                '/admin/test/add-game-interest AND the ROK-1314 backend mapper)',
        },
    );
});

// ---------------------------------------------------------------------------
// AC1 / AC2 — Common Ground: personalized pill ALONGSIDE the aggregate
// ---------------------------------------------------------------------------

test.describe('Common Ground — personalized ownership badges (AC1/AC2)', () => {
    test('the owner sees BOTH "You own" and the owner aggregate', async ({
        page,
    }) => {
        await loginAs(page, adminToken);
        const tile = await commonGroundTile(page);

        await expect(tile.getByText('You own', { exact: true })).toBeVisible({
            timeout: 15_000,
        });
        // The personalized pill NEVER replaces the aggregate (spec §5.1).
        await expect(tile.getByText(/\d+ own$/)).toBeVisible({ timeout: 10_000 });
    });

    test('the wishlister sees BOTH "You wishlisted" and the wishlist aggregate', async ({
        page,
    }) => {
        await loginAs(page, inviteeToken);
        const tile = await commonGroundTile(page);

        await expect(
            tile.getByText('You wishlisted', { exact: true }),
        ).toBeVisible({ timeout: 15_000 });
        await expect(tile.getByText(/\d+ wishlisted$/)).toBeVisible({
            timeout: 10_000,
        });
    });

    test('the wishlister never sees "You own" on the same tile the owner does', async ({
        page,
    }) => {
        await loginAs(page, inviteeToken);
        const tile = await commonGroundTile(page);

        await expect(
            tile.getByText('You wishlisted', { exact: true }),
        ).toBeVisible({ timeout: 15_000 });
        // Same row, same game, different viewer — no flag leak (spec §4.5).
        await expect(tile.getByText('You own', { exact: true })).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC9 — the Library page: two viewers, one game, different badge states
// ---------------------------------------------------------------------------

test.describe('Game Library — two viewers see different badge states (AC9)', () => {
    test('the owner sees "You own" on the library card', async ({ page }) => {
        await loginAs(page, adminToken);
        await openLibraryFor(page);

        await expect(
            page.getByText('You own', { exact: true }).first(),
        ).toBeVisible({ timeout: 15_000 });
        // The admin has no wishlist row for this game — the two pills are
        // independent signals, not a single tri-state.
        await expect(
            page.getByText('You wishlisted', { exact: true }),
        ).toHaveCount(0);
    });

    test('the wishlister sees "You wishlisted" on the same library card', async ({
        page,
    }) => {
        await loginAs(page, inviteeToken);
        await openLibraryFor(page);

        await expect(
            page.getByText('You wishlisted', { exact: true }).first(),
        ).toBeVisible({ timeout: 15_000 });
        // The invitee owns nothing at all, so a page-scoped absence check is
        // exact here: "You own" must not appear anywhere on their Library.
        await expect(page.getByText('You own', { exact: true })).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC4 — anonymous viewer: no personalization, aggregates intact
// ---------------------------------------------------------------------------

test.describe('Anonymous viewer — no personalization (AC4)', () => {
    test('anonymous viewer: both flags false, aggregates untouched', async () => {
        // Half 1 — the unguarded GameDetailDto route. Spec §4.5: no viewer
        // means an explicit `false`, never `undefined`, never a 401, never
        // another user's flag.
        const res = await fetch(`${API_BASE}/games/${gameId}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            currentUserOwns?: boolean;
            currentUserWishlisted?: boolean;
        };
        expect(body.currentUserOwns).toBe(false);
        expect(body.currentUserWishlisted).toBe(false);

        // Half 2 — only the personalization drops out. The aggregate is public
        // information and must survive the absence of a viewer (spec §6).
        const row = await pollForCondition(
            async () => {
                const cg = await apiGet(
                    adminToken,
                    `/lineups/common-ground?minOwners=0&search=${encodeURIComponent(
                        gameName,
                    )}&lineupId=${lineupId}`,
                );
                const found = (
                    cg?.data as { gameId: number; ownerCount: number }[] | undefined
                )?.find((g) => g.gameId === gameId);
                return found ?? null;
            },
            {
                timeoutMs: 15_000,
                description: 'common-ground row for the fixture game',
            },
        );
        expect(row.ownerCount).toBeGreaterThanOrEqual(1);
    });

    // NOTE: there is deliberately NO "anonymous browser session" test here.
    // Every SPA route that renders a game card (`/games`, `/games/:id`,
    // `/community-lineup/:id`) sits behind AuthGuard, so an anonymous browser
    // is redirected to login and can never render a badge — an assertion there
    // would pass vacuously both before and after the implementation, which is
    // worse than no test. AC4's browser half is carried by the invitee cases
    // above: a real logged-in viewer who does not own the game must never see
    // "You own" on the very card that shows it to the admin.
});
