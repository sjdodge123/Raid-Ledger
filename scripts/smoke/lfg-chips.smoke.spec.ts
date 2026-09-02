/**
 * ROK-1453 — LFG chips on the games and events pages (AC1-AC4, AC6, AC7).
 *
 * Surfaces driven, all as the admin viewer:
 *   • /games search grid — the chip's two states and its absence (AC1/2/4)
 *   • the chip link-through to /lfg/:gameSlug (AC1; the page itself is
 *     ROK-1464 — this spec asserts the URL only, so it is green either way)
 *   • /events aggregate banner → the filtered Library view (AC3)
 *   • the cold-start hearted prompt + its session dismissal (AC6)
 *
 * ─── SEED STRATEGY (spec decision D8 — no LFG seeder endpoint) ──────────────
 * Intents are created through the REAL `POST /lfg`, one call per (user, game),
 * using the existing `getInviteeFixture()` second persona for the +1. The
 * three games come from `POST /admin/test/seed-cooptimus` (ROK-1398), which is
 * idempotent and gives us a deterministic trio reachable through ONE search
 * query, with the viability spread this story needs:
 *
 *   A  Empty Fixture     cooptimusOnlineMax null  1 intent  (invitee)      lfg
 *   B  Unsynced Fixture  cooptimusOnlineMax null  2 intents (admin+invit)  lfm
 *   C  Enriched Fixture  cooptimusOnlineMax 4     0 intents                none
 *
 * `POST /lfg` is idempotent for an existing holder (a re-post only refreshes
 * the clock), so the seed runs in `beforeEach`: the desktop and mobile
 * projects execute this file concurrently in separate workers, and a sibling
 * project's cleanup must not be able to leave a later test unseeded. Every UI
 * assertion is gated behind a `GET /lfg` poll first (ROK-1156 staleTime rule).
 *
 * CROSS-PROJECT STATE (reviewer finding). Both projects drive the SAME three
 * seeded games as the SAME two users, so any teardown that deletes an intent
 * deletes it for the sibling project mid-test. Two rules follow:
 *   1. **Intents are never deleted here.** They expire on their own and every
 *      test re-seeds + polls before asserting, so a lingering intent is inert
 *      while a mid-flight delete is a false failure.
 *   2. **The heart used by the cold-start prompt is chosen per project**
 *      (`heartedFixture()`), so each project clears only its own row.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * DUAL-GRID RULE (`games.smoke.spec.ts:144-153`): search results render twice
 * (`hidden md:grid` + `md:hidden`). Presence assertions scope to `:visible`
 * and `.first()`; absence assertions stay page-scoped and UNQUALIFIED, so a
 * chip that must not exist must not exist in EITHER tree. That is also why the
 * cold-start prompt's entries carry `data-testid="lfg-hearted-prompt-game"`
 * and never `lfg-chip` (spec D9) — a prompt entry wearing the chip testid
 * would make the absence assertion below unprovable.
 *
 * TDD: written before the implementation; every chip/banner/prompt assertion
 * fails on the pre-implementation tree.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import {
    getAdminToken,
    getInviteeFixture,
    apiGet,
    apiPost,
    pollForCondition,
} from './api-helpers';

const HOOK_TIMEOUT_MS = 90_000;

/** Canonical names of the ROK-1398 co-op fixtures (demo-test-cooptimus.helpers.ts). */
const NAME_A = 'ROK-1398 Co-Op Empty Fixture';
const NAME_B = 'ROK-1398 Co-Op Unsynced Fixture';
const NAME_C = 'ROK-1398 Co-Op Enriched Fixture';
const FIXTURE_QUERY = 'ROK-1398 Co-Op';

const CHIP = '[data-testid="lfg-chip"]';

/**
 * A search string that reaches ONE fixture. The shared `FIXTURE_QUERY` prefix
 * returns all three, so an absence assertion made after searching it would be
 * answered by A's and B's chips.
 */
const ONLY_C_QUERY = 'Enriched Fixture';

/**
 * The game each project hearts for the cold-start prompt. Distinct per project
 * so one project's `clear-game-interest` cannot pull the prompt out from under
 * the other. Both are valid: `GET /lfg/hearted` excludes only the CALLER's own
 * live intents, and the admin holds none on either game.
 */
function heartedFixture(): { gameId: number; name: string } {
    return test.info().project.name === 'mobile'
        ? { gameId: gameA, name: NAME_A }
        : { gameId: gameC, name: NAME_C };
}

let adminToken: string;
let adminUserId: number;
let inviteeToken: string;
let gameA: number;
let gameB: number;
let gameC: number;

interface LfgGroupRow {
    gameId: number;
    gameSlug?: string;
    activeCount: number;
    state: 'lfg' | 'lfm' | null;
}

/** Post the three intents. Idempotent — safe to re-run before every test. */
async function seedIntents(): Promise<void> {
    await apiPost(inviteeToken, '/lfg', { gameId: gameA });
    await apiPost(adminToken, '/lfg', { gameId: gameB });
    await apiPost(inviteeToken, '/lfg', { gameId: gameB });
}

/** Poll `GET /lfg` until both seeded groups are live, and return the rows. */
async function waitForSeededGroups(): Promise<LfgGroupRow[]> {
    return pollForCondition(
        async () => {
            const rows = (await apiGet(adminToken, '/lfg')) as
                | LfgGroupRow[]
                | null;
            const a = rows?.find((r) => r.gameId === gameA);
            const b = rows?.find((r) => r.gameId === gameB);
            return a?.activeCount === 1 && b && b.activeCount >= 2
                ? rows
                : null;
        },
        {
            timeoutMs: 20_000,
            description:
                'GET /lfg reports 1 intent on the Empty fixture and 2 on the Unsynced fixture',
        },
    );
}

/** Search the Library down to a single fixture game and wait for its tile. */
async function openLibraryFor(
    page: Page,
    query: string,
    gameId: number,
): Promise<void> {
    await page.goto('/games');
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 15_000,
    });
    await page.getByPlaceholder('Search games...').fill(query);
    await expect(
        page.locator(`a[href="/games/${gameId}"]:visible`).first(),
    ).toBeVisible({ timeout: 20_000 });
}

/** The chip the current viewport actually shows. */
function visibleChip(page: Page) {
    return page.locator(`${CHIP}:visible`).first();
}

test.beforeAll(async () => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    adminToken = await getAdminToken();
    const me = (await apiGet(adminToken, '/auth/me')) as { id: number };
    adminUserId = me.id;
    inviteeToken = (await getInviteeFixture()).jwt;

    const seed = (await apiPost(adminToken, '/admin/test/seed-cooptimus')) as {
        enrichedGameId: number;
        syncedEmptyGameId: number;
        unsyncedGameId: number;
    };
    gameA = seed.syncedEmptyGameId;
    gameB = seed.unsyncedGameId;
    gameC = seed.enrichedGameId;
    expect(gameA, 'seed-cooptimus must return the empty fixture id').toBeTruthy();

    // The fixtures have to be reachable through the page's own search before
    // any UI assertion — otherwise a search-behaviour surprise reads as a
    // missing chip.
    await pollForCondition(
        async () => {
            const res = await apiGet(
                adminToken,
                `/games/search?q=${encodeURIComponent(FIXTURE_QUERY)}`,
            );
            const ids = (res?.data as { id: number }[] | undefined)?.map(
                (g) => g.id,
            );
            return ids?.includes(gameA) &&
                ids.includes(gameB) &&
                ids.includes(gameC)
                ? res
                : null;
        },
        {
            timeoutMs: 20_000,
            description: 'all three co-op fixtures are searchable',
        },
    );
});

test.beforeEach(async () => {
    await seedIntents();
});

test.afterAll(async () => {
    // Deliberately NOT deleting the intents: the sibling project is still
    // running against the same rows (see CROSS-PROJECT STATE above). They
    // expire by themselves, and every test re-seeds before it asserts.
    await apiPost(adminToken, '/admin/test/clear-game-interest', {
        userId: adminUserId,
        gameId: heartedFixture().gameId,
    });
});

// ---------------------------------------------------------------------------
// Fixture gate — deliberately a TEST, not a beforeAll throw. A failing hook
// aborts the file and would mask every UI assertion behind one seed problem.
// ---------------------------------------------------------------------------

test('fixture: the seeded intents reach GET /lfg carrying gameSlug', async () => {
    const rows = await waitForSeededGroups();

    const a = rows.find((r) => r.gameId === gameA)!;
    const b = rows.find((r) => r.gameId === gameB)!;
    expect(a.state).toBe('lfg');
    expect(b.state).toBe('lfm');
    // AC8 — the chip's link target. Without it the chip has nowhere to go.
    expect(a.gameSlug).toMatch(/^[a-z0-9-]+$/);
    expect(b.gameSlug).toMatch(/^[a-z0-9-]+$/);
});

// ---------------------------------------------------------------------------
// AC1 / AC2 / AC4 — the tile chip on /games
// ---------------------------------------------------------------------------

test.describe('Game Library — the LFG chip (AC1/AC2/AC4)', () => {
    test('a single player reads "1 looking · needs 1 more"', async ({
        page,
    }) => {
        await waitForSeededGroups();
        await openLibraryFor(page, NAME_A, gameA);

        const chip = visibleChip(page);
        await expect(chip).toBeVisible({ timeout: 15_000 });
        await expect(chip).toHaveText('🎯 1 looking · needs 1 more');
        await expect(chip).toHaveAttribute('data-lfg-state', 'lfg');
    });

    test('two players read "2 looking to play"', async ({ page }) => {
        await waitForSeededGroups();
        await openLibraryFor(page, NAME_B, gameB);

        const chip = visibleChip(page);
        await expect(chip).toBeVisible({ timeout: 15_000 });
        await expect(chip).toHaveText('🎯 2 looking to play');
        await expect(chip).toHaveAttribute('data-lfg-state', 'lfm');
    });

    test('a game nobody is looking for has no chip at all', async ({ page }) => {
        await waitForSeededGroups();
        // A C-only query: searching the shared prefix would also return A and
        // B, whose chips would answer the unqualified absence assertion below.
        await openLibraryFor(page, ONLY_C_QUERY, gameC);
        await expect(page.locator(`a[href="/games/${gameA}"]`)).toHaveCount(0);

        // Unqualified on purpose: no chip in EITHER grid, and never "0 looking".
        await expect(page.locator(CHIP)).toHaveCount(0);
        await expect(page.getByText(/0 looking/)).toHaveCount(0);
    });

    test('the chip links through to the game LFG page', async ({ page }) => {
        await waitForSeededGroups();
        await openLibraryFor(page, NAME_B, gameB);

        await visibleChip(page).click();

        // ROK-1464 owns the destination page; this asserts the URL only.
        await expect(page).toHaveURL(/\/lfg\/[a-z0-9-]+$/, { timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// AC3 — the events aggregate banner and the filtered Library view
// ---------------------------------------------------------------------------

test.describe('Events page — the LFG summary banner (AC3)', () => {
    test('the banner counts the live groups and links to the filtered view', async ({
        page,
    }) => {
        const rows = await waitForSeededGroups();
        // The banner renders the SAME count GET /lfg reports; our two seeds are
        // the floor, so the plural copy is the one under assertion.
        const expected = rows.length;
        expect(expected).toBeGreaterThanOrEqual(2);

        await page.goto('/events');
        const banner = page.getByTestId('lfg-summary-banner');
        await expect(banner).toBeVisible({ timeout: 20_000 });
        await expect(banner).toContainText(
            `${expected} games have players looking`,
        );

        await banner.click();
        await expect(page).toHaveURL(/\/games\?lfg=1$/, { timeout: 15_000 });
    });

    test('the lfg view lists every game GET /lfg reports', async ({ page }) => {
        const rows = await waitForSeededGroups();

        await page.goto('/games?lfg=1');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 15_000 },
        );

        // The seeded fixtures are in NO discover carousel, so they only appear
        // if the view is built from the LFG rows themselves rather than by
        // filtering the carousels (operator walk: banner said 3, page showed 1).
        // No search is typed — that is the point.
        await expect(
            page.locator(`a[href="/games/${gameA}"]:visible`).first(),
        ).toBeVisible({ timeout: 20_000 });
        await expect(
            page.locator(`a[href="/games/${gameB}"]:visible`).first(),
        ).toBeVisible({ timeout: 15_000 });
        // One tile per row the API returned — the banner's count and the grid
        // cannot disagree.
        await expect(page.getByTestId('lfg-looking-tile')).toHaveCount(
            rows.length,
        );
        // C has no intent, so it is not one of those rows.
        await expect(page.locator(`a[href="/games/${gameC}"]`)).toHaveCount(0);
        // The filter is dismissible (D6) — the user must be able to get out.
        await expect(page.getByTestId('lfg-filter-chip')).toBeVisible({
            timeout: 15_000,
        });
    });
});

// ---------------------------------------------------------------------------
// AC6 — the cold-start prompt
// ---------------------------------------------------------------------------

test.describe('Games page — cold-start hearted prompt (AC6)', () => {
    test('surfaces a hearted game, then stays dismissed for the session', async ({
        page,
    }) => {
        const hearted = heartedFixture();
        await apiPost(adminToken, '/admin/test/clear-game-interest', {
            userId: adminUserId,
            gameId: hearted.gameId,
        });
        await apiPost(adminToken, '/admin/test/add-game-interest', {
            userId: adminUserId,
            gameId: hearted.gameId,
        });
        try {
            await pollForCondition(
                async () => {
                    const rows = (await apiGet(adminToken, '/lfg/hearted')) as
                        | { gameId: number }[]
                        | null;
                    return rows?.some((r) => r.gameId === hearted.gameId)
                        ? rows
                        : null;
                },
                {
                    timeoutMs: 20_000,
                    description: 'GET /lfg/hearted lists the hearted fixture',
                },
            );

            await page.goto('/games');
            const prompt = page.getByTestId('lfg-hearted-prompt');
            await expect(prompt).toBeVisible({ timeout: 20_000 });
            await expect(prompt).toContainText(hearted.name);

            await prompt.getByRole('button', { name: 'Dismiss' }).click();
            await expect(prompt).toHaveCount(0);

            // Session-scoped dismissal survives a reload (D7).
            await page.reload();
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 15_000 },
            );
            await expect(page.getByTestId('lfg-hearted-prompt')).toHaveCount(0);
        } finally {
            await apiPost(adminToken, '/admin/test/clear-game-interest', {
                userId: adminUserId,
                gameId: hearted.gameId,
            });
        }
    });
});
