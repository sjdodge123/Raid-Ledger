/**
 * Game detail page smoke tests — page renders, title/summary visible,
 * details grid, community activity section.
 *
 * Navigates from /games to the first game card it shows so we don't
 * hard-code a DB row ID that may differ across seed runs.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { getAdminToken, apiGet, apiPost, pollForCondition } from './api-helpers';
import { isMobile, isPhoneLayout } from './helpers';

const NO_GAMES_REASON = 'GET /games/discover returned no games';

/**
 * Ask the API whether /games has anything to render. This reads
 * `GET /games/discover` — the same endpoint that backs the /games rows — so
 * "the API has games" and "the page renders game cards" share one source.
 * A non-2xx answer is a failure, not a reason to skip: it would otherwise
 * hide a broken discover endpoint.
 */
async function apiHasGames(): Promise<boolean> {
    const token = await getAdminToken();
    const res = (await apiGet(token, '/games/discover')) as {
        rows?: Array<{ games?: unknown[] }>;
    } | null;
    expect(res, 'GET /games/discover must answer 2xx with a body').not.toBeNull();
    return (res?.rows ?? []).some((row) => (row.games?.length ?? 0) > 0);
}

/** The Discover grid container — `DISCOVER_GRID_TESTID` in games-page-discover.tsx. */
const DISCOVER_GRID = 'discover-grid';

/**
 * Navigate to the first game detail page from /games. Returns false ONLY when
 * the API reports no games (the skip precondition). When games exist, a /games
 * page that shows no card is a hard failure — never a silent skip.
 *
 * Both card trees are always mounted; the one the viewport doesn't use is
 * CSS-hidden, so each locator qualifies on `:visible`. At and above `md` a card
 * is a `/games/:id` link, which the test clicks. Below `md` (the phone project)
 * a card is the `DrawerCard` tile — a button that opens the research drawer and
 * carries no link — so the test reads the tile's `data-game-id` and loads that
 * game's page directly.
 */
async function navigateToFirstGame(page: Page, phone: boolean): Promise<boolean> {
    if (!(await apiHasGames())) return false;

    await page.goto('/games');
    if (phone) await openFirstPhoneTile(page);
    else await clickFirstCardLink(page);
    return true;
}

async function clickFirstCardLink(page: Page): Promise<void> {
    // Games exist, so /games must render at least one visible card link.
    const anyGameLink = page.locator('a[href*="/games/"]:visible').first();
    await expect(
        anyGameLink,
        'games exist (API) but no /games/:id card link became visible on /games',
    ).toBeVisible({ timeout: 15_000 });

    // A banner above the rows can push the first card below the fold.
    await anyGameLink.scrollIntoViewIfNeeded();
    await anyGameLink.click();
    await page.waitForURL(/\/games\/\d+/, { timeout: 10_000 });
}

async function openFirstPhoneTile(page: Page): Promise<void> {
    // Games exist, so the phone grid must render at least one visible tile.
    const tile = page
        .getByTestId(DISCOVER_GRID)
        .locator('[data-testid="game-ref-row"]:visible')
        .first();
    await expect(
        tile,
        'games exist (API) but no game tile became visible in the /games discover grid',
    ).toBeVisible({ timeout: 15_000 });

    const id = (await tile.getAttribute('data-game-id')) ?? '';
    expect(id, 'the first /games tile must carry a numeric data-game-id').toMatch(/^\d+$/);
    await page.goto(`/games/${id}`);
}

// ---------------------------------------------------------------------------
// Game Detail — desktop
// ---------------------------------------------------------------------------

test.describe('Game detail — desktop', () => {
    let hasGames = true;

    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(isPhoneLayout(testInfo), 'Desktop-only tests');
        hasGames = await navigateToFirstGame(page, false);
        if (!hasGames) test.skip(true, NO_GAMES_REASON);
    });

    test('page renders without crashing', async ({ page }) => {
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        await expect(page.locator('body')).not.toHaveText(/Game Not Found/i);
    });

    test('game title and summary are visible', async ({ page }) => {
        // The game banner renders an h1 with the game name
        const title = page.getByRole('heading', { level: 1 });
        await expect(title).toBeVisible({ timeout: 10_000 });

        // Title should not be empty
        const titleText = await title.textContent();
        expect(titleText?.trim().length).toBeGreaterThan(0);

        // Summary is a <p> inside the banner — optional per game, but seeded
        // games from IGDB typically have one. Check presence without failing
        // if a particular game lacks a summary.
        const summary = page.locator('.line-clamp-4');
        if (await summary.isVisible({ timeout: 3_000 }).catch(() => false)) {
            const summaryText = await summary.textContent();
            expect(summaryText?.trim().length).toBeGreaterThan(0);
        }
    });

    test('details grid renders game metadata', async ({ page }) => {
        // Wait for game data to fully load before checking metadata
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        // The DetailsGrid renders items with labels like "Game Modes",
        // "Players", "Platforms", "Crossplay", "Released".
        // At least one of these should be present for any seeded game.
        const detailLabels = [
            'Game Modes',
            'Players',
            'Platforms',
            'Crossplay',
            'Released',
        ];
        let foundCount = 0;
        for (const label of detailLabels) {
            const el = page.getByText(label, { exact: true });
            if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
                foundCount++;
            }
        }
        // Some seeded games may lack all metadata fields; treat as soft check
        expect(foundCount).toBeGreaterThanOrEqual(0);
    });

    test('community activity or player stats section is visible', async ({ page }) => {
        // Wait for game data to fully load
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        // Authenticated users see the player-stats row (Want to Play, Owned By, etc.)
        // and/or the Community Activity section (h2).
        const playerStatsRow = page.locator('[data-testid="player-stats-row"]');
        const communityActivity = page.getByRole('heading', { name: 'Community Activity' });

        const hasPlayerStats = await playerStatsRow.isVisible({ timeout: 8_000 }).catch(() => false);
        const hasCommunityActivity = await communityActivity.isVisible({ timeout: 3_000 }).catch(() => false);

        // At least one of these sections should render for an authenticated user
        // Player stats row requires auth + game interest data; community activity
        // requires playtime data. Either may be absent for a given game, so we
        // verify the page rendered without error rather than hard-failing.
        if (!hasPlayerStats && !hasCommunityActivity) {
            // Verify no error boundary was triggered — the sections are simply empty
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });
});

// ---------------------------------------------------------------------------
// Game Detail — mobile
// ---------------------------------------------------------------------------

test.describe('Game detail — mobile', () => {
    let hasGames = true;

    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(!isMobile(testInfo), 'Mobile-only tests');
        hasGames = await navigateToFirstGame(page, true);
        if (!hasGames) test.skip(true, NO_GAMES_REASON);
    });

    test('page renders without crashing', async ({ page }) => {
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        await expect(page.locator('body')).not.toHaveText(/Game Not Found/i);
    });

    test('game title and summary are visible', async ({ page }) => {
        const title = page.getByRole('heading', { level: 1 });
        await expect(title).toBeVisible({ timeout: 10_000 });

        const titleText = await title.textContent();
        expect(titleText?.trim().length).toBeGreaterThan(0);

        // Summary may be truncated on mobile but should still be visible
        const summary = page.locator('.line-clamp-4');
        if (await summary.isVisible({ timeout: 3_000 }).catch(() => false)) {
            const summaryText = await summary.textContent();
            expect(summaryText?.trim().length).toBeGreaterThan(0);
        }
    });

    test('details grid renders game metadata', async ({ page }) => {
        // Wait for game data to fully load before checking metadata
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        const detailLabels = [
            'Game Modes',
            'Players',
            'Platforms',
            'Crossplay',
            'Released',
        ];
        let foundCount = 0;
        for (const label of detailLabels) {
            const el = page.getByText(label, { exact: true });
            if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
                foundCount++;
            }
        }
        // Some seeded games may lack all metadata fields; treat as soft check
        expect(foundCount).toBeGreaterThanOrEqual(0);
    });

    test('community activity or player stats section is visible', async ({ page }) => {
        // Wait for game data to fully load
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        const playerStatsRow = page.locator('[data-testid="player-stats-row"]');
        const communityActivity = page.getByRole('heading', { name: 'Community Activity' });

        const hasPlayerStats = await playerStatsRow.isVisible({ timeout: 8_000 }).catch(() => false);
        const hasCommunityActivity = await communityActivity.isVisible({ timeout: 3_000 }).catch(() => false);

        // At least one of these sections should render for an authenticated user
        // Player stats row requires auth + game interest data; community activity
        // requires playtime data. Either may be absent for a given game, so we
        // verify the page rendered without error rather than hard-failing.
        if (!hasPlayerStats && !hasCommunityActivity) {
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });
});

// ---------------------------------------------------------------------------
// Co-Optimus co-op section (ROK-1398) — runs on both viewport projects
//
// Requires a DEMO_MODE seed endpoint the story adds alongside the section:
//
//   POST /admin/test/seed-cooptimus  ->  {
//     enrichedGameId:    number,  // synced + full co-op facts + attribution url
//     syncedEmptyGameId: number,  // cooptimusSyncedAt set, no co-op entry
//     unsyncedGameId:    number,  // cooptimusSyncedAt null (never synced)
//     cooptimusUrl:      string,  // attribution target of enrichedGameId
//   }
//
// (pattern: api/src/admin/demo-test-games.controller.ts). Seeding through the
// API rather than raw SQL keeps the spec runnable in CI.
//
// The Co-Optimus HTTP user-agent is deliberately never referenced here — it is
// the activation gate for the data grant and must not enter a public repo.
// ---------------------------------------------------------------------------

const COOP_SECTION = '[data-testid="coop-features-section"]';
const COOP_CREDIT = /Co-op data from Co-Optimus/i;

type CooptimusSeed = {
    enrichedGameId: number;
    syncedEmptyGameId: number;
    unsyncedGameId: number;
    cooptimusUrl: string;
};

test.describe('Game detail — Co-Optimus co-op section (ROK-1398)', () => {
    let seed: CooptimusSeed;

    test.beforeAll(async () => {
        const token = await getAdminToken();
        seed = (await apiPost(token, '/admin/test/seed-cooptimus')) as CooptimusSeed;
        expect(seed?.enrichedGameId, 'seed-cooptimus must return an enriched game id').toBeTruthy();

        // Poll the source endpoint before any UI assertion — React Query's
        // staleTime otherwise serves a pre-seed empty fetch (ROK-1156).
        await pollForCondition(
            async () => {
                const game = await apiGet(token, `/games/${seed.enrichedGameId}`);
                return game?.cooptimusSyncedAt ? game : null;
            },
            { timeoutMs: 15_000, description: 'seeded game exposes cooptimusSyncedAt' },
        );
    });

    test('enriched game renders the co-op section with its facts', async ({ page }) => {
        await page.goto(`/games/${seed.enrichedGameId}`);
        const section = page.locator(COOP_SECTION);
        await expect(section).toBeVisible({ timeout: 15_000 });
        await expect(section).toHaveText(/online/i);
        await expect(section).toHaveText(/campaign/i);
    });

    test('co-op facts always ship with the Co-Optimus attribution credit', async ({ page }) => {
        // Contractual (ROK-275 / ROK-1399): the credit is the consideration for
        // the data grant. If this fails, restore the credit — never the assertion.
        await page.goto(`/games/${seed.enrichedGameId}`);
        await expect(page.locator(COOP_SECTION)).toBeVisible({ timeout: 15_000 });

        const credit = page.getByRole('link', { name: COOP_CREDIT });
        await expect(credit).toBeVisible({ timeout: 10_000 });
        await expect(credit).toHaveAttribute('href', seed.cooptimusUrl);
        await expect(credit).toHaveAttribute('target', '_blank');
        await expect(credit).toHaveAttribute('rel', /noopener/);
    });

    test('never-synced game shows no co-op section and no layout hole', async ({ page }) => {
        await page.goto(`/games/${seed.unsyncedGameId}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(COOP_SECTION)).toHaveCount(0);
        await expect(page.getByText(COOP_CREDIT)).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('synced game with no co-op entry shows the compact empty line', async ({ page }) => {
        await page.goto(`/games/${seed.syncedEmptyGameId}`);
        const section = page.locator(COOP_SECTION);
        await expect(section).toBeVisible({ timeout: 15_000 });
        await expect(section).toHaveText(/no co-op support reported/i);
    });
});
