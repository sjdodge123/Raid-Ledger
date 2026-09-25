/**
 * Games page smoke tests — page load, mobile card spacing, mobile search styling,
 * co-op filters in the Filters entry (ROK-1402, ROK-1659).
 */
import { test, expect } from './base';
import type { Locator, Page } from '@playwright/test';
import { getAdminToken, apiGet, apiPost, pollForCondition } from './api-helpers';
import { closeGamesFilters, openGamesFilters } from './games-filters';
import { isMobile } from './helpers';

test.describe('Games page', () => {
    test('page loads without crashing', async ({ page }) => {
        await page.goto('/games');
        // Games page may show "Discover" tab or game cards depending on IGDB data
        // Wait for page to settle by checking for absence of error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-811 — games page mobile cards cramped together
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-811 — games page mobile card spacing', () => {
    test('game cards in carousel sections are visible at mobile viewport', async ({ browser }, testInfo) => {
        test.skip(!isMobile(testInfo), 'Mobile-only test');

        const context = await browser.newContext({
            viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Look for carousel row headings on mobile (h2 elements inside the discover view)
        const carouselHeadings = page.locator('h2');
        if (await carouselHeadings.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Game cards within the first carousel row — scroll past banner if needed
            const gameCards = page.locator('a[href*="/games/"]');
            await expect(gameCards.first()).toBeAttached({ timeout: 5_000 });
            await gameCards.first().scrollIntoViewIfNeeded();
            await expect(gameCards.first()).toBeVisible({ timeout: 3_000 });
        }

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-813 — games page search container styling on mobile
// ---------------------------------------------------------------------------

test.describe('Regression: ROK-813 — games page mobile search styling', () => {
    test('search input and tab toggle are visible at mobile viewport', async ({ browser }, testInfo) => {
        test.skip(!isMobile(testInfo), 'Mobile-only test');

        const context = await browser.newContext({
            viewport: { width: 375, height: 812 },
        });
        const page = await context.newPage();

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Search input should be visible on mobile
        const searchInput = page.getByPlaceholder('Search games...');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Tab toggle is only rendered for admins — check if present and visible
        const tabToggle = page.getByRole('button', { name: /discover/i });
        if (await tabToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await expect(tabToggle).toBeVisible();
        }

        await context.close();
    });
});

// ---------------------------------------------------------------------------
// ROK-1402 — co-op filters on the games library page
//
// Since ROK-1659 the co-op controls are one group (`coop-filter-group`) in the
// /games Filters entry (`games-filters.ts`: the toolbar funnel + inline panel
// at 1024px and up, the Filters FAB + BottomSheet below). The group is rendered
// only while some loaded game carries Co-Optimus data (ROK-1402 dormancy):
//   • Online-players predicate: the shared Slider, named by its visible label
//     "Online co-op" (ROK-1650 ruling 12; 0 = "Any"/inactive).
//   • Boolean toggles: "Couch co-op", "LAN co-op", "Split-screen",
//     "Co-op campaign".
//   • Hint line `[data-testid="coop-filter-hint"]` reading
//     "Showing games with co-op data", rendered only while a predicate is on.
//
// Fixtures come from the DEMO_MODE `POST /admin/test/seed-cooptimus` endpoint
// (PR #1032) — the same three rows the game-detail spec drives:
//   enriched     cooptimusOnlineMax 4, splitscreen/campaign true
//   syncedEmpty  synced, every co-op column null  -> excluded, hint shown
//   unsynced     never synced, every column null  -> excluded, hint shown
// Strict semantics (operator 2026-08-20): only `cooptimusOnlineMax` feeds the
// numeric predicate — there is no IGDB `playerCount` fallback — so both null
// rows drop out of any active predicate.
//
// Every test searches for the fixtures BEFORE touching the filter. The group
// is dormant until some loaded game carries co-op data, and the seeded
// fixtures reach the page through search rather than the curated discover rows,
// so the search is what activates the group on a demo-seeded library. It also
// keeps AC2 honest: the predicate and the query must intersect.
//
// The Co-Optimus HTTP user-agent is deliberately never referenced here.
// ---------------------------------------------------------------------------

const COOP_HINT = '[data-testid="coop-filter-hint"]';
const COOP_GROUP = 'coop-filter-group';
const FIXTURE_QUERY = 'ROK-1398 Co-Op';

/**
 * Every column `hasAnyCoopData` reads (`web/src/pages/games/coop-filter.helpers.ts`)
 * — mirrored, not imported: a smoke spec cannot import from `web/src`.
 */
const COOP_COLUMNS = [
    'cooptimusSyncedAt',
    'cooptimusOnlineMax',
    'cooptimusCouchMax',
    'cooptimusLanMax',
    'cooptimusSplitscreen',
    'cooptimusCampaignCoop',
] as const;

type DiscoverBody = { rows?: { games?: Record<string, unknown>[] }[] };

/** The discover payload with every co-op column blanked — a library with no Co-Optimus sync. */
function withoutCoopData(body: DiscoverBody): DiscoverBody {
    const blank = Object.fromEntries(COOP_COLUMNS.map((column) => [column, null]));
    return {
        ...body,
        rows: (body.rows ?? []).map((row) => ({
            ...row,
            games: (row.games ?? []).map((game) => ({ ...game, ...blank })),
        })),
    };
}

type CooptimusSeed = {
    enrichedGameId: number;
    syncedEmptyGameId: number;
    unsyncedGameId: number;
    cooptimusUrl: string;
};

/** Open the Filters entry and wait for the co-op group's slider inside it. */
async function openCoopControls(page: Page): Promise<Locator> {
    const filters = await openGamesFilters(page);
    await expect(filters.getByTestId(COOP_GROUP)).toBeVisible({ timeout: 10_000 });
    await expect(onlineSlider(filters)).toBeVisible({ timeout: 10_000 });
    return filters;
}

function onlineSlider(filters: Locator): Locator {
    return filters.getByRole('slider', { name: 'Online co-op', exact: true });
}

/**
 * Set the online-players predicate. The control is a range slider (operator
 * review 2026-08-20), which `fill()` cannot drive — Home parks it at the
 * minimum and each ArrowRight steps it up by one, both of which fire the real
 * input events React listens for. `minPlayers: 0` therefore clears it.
 */
async function setOnlineMin(page: Page, filters: Locator, minPlayers: number): Promise<void> {
    await onlineSlider(filters).focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < minPlayers; i++) await page.keyboard.press('ArrowRight');
}

/** Open, set, and close again so the results underneath are clickable. */
async function applyOnlineCoopFilter(page: Page, minPlayers: number): Promise<void> {
    await setOnlineMin(page, await openCoopControls(page), minPlayers);
    await closeGamesFilters(page);
}

/** Type a query into the games-page search box. */
async function searchGames(page: Page, query: string): Promise<void> {
    await page.getByPlaceholder('Search games...').fill(query);
}

/**
 * Search results are rendered twice — a `hidden md:grid` desktop grid and a
 * `md:hidden` mobile grid — so a bare href locator is ambiguous under strict
 * mode. Pick the copy the current viewport actually shows (same `:visible`
 * pattern as `game-research-drawer.smoke.spec.ts`). Exclusion assertions keep
 * the bare locator: `toHaveCount(0)` must hold across BOTH grids.
 */
function visibleGameLink(page: Page, gameId: number) {
    return page.locator(`a[href="/games/${gameId}"]:visible`).first();
}

test.describe('Games page — co-op filters in the Filters entry (ROK-1402)', () => {
    let seed: CooptimusSeed;

    test.beforeAll(async () => {
        const token = await getAdminToken();
        seed = (await apiPost(token, '/admin/test/seed-cooptimus')) as CooptimusSeed;
        expect(seed?.enrichedGameId, 'seed-cooptimus must return an enriched game id').toBeTruthy();

        // Poll the source endpoint before any UI assertion — React Query's
        // staleTime otherwise serves a pre-seed fetch for the whole test (ROK-1156).
        await pollForCondition(
            async () => {
                const res = await apiGet(
                    token,
                    `/games/search?q=${encodeURIComponent(FIXTURE_QUERY)}`,
                );
                const enriched = res?.data?.find(
                    (g: { id: number }) => g.id === seed.enrichedGameId,
                );
                return enriched?.cooptimusOnlineMax ? res : null;
            },
            { timeoutMs: 20_000, description: 'co-op fixtures searchable with cooptimusOnlineMax' },
        );
    });

    test('the co-op controls appear in the Filters entry only while co-op data is loaded', async ({ page }) => {
        // A library with no Co-Optimus sync: the real discover rows, co-op
        // columns blanked. Whatever the env's corpus carries, the ONLY co-op
        // data this page can see is what the fixture search brings in below.
        await page.route('**/games/discover**', async (route) => {
            const response = await route.fetch();
            const body = (await response.json()) as DiscoverBody;
            await route.fulfill({ response, json: withoutCoopData(body) });
        });
        await page.goto('/games');
        // The discover rows have rendered, so the dormancy below is a verdict
        // on loaded data — not a panel read before anything arrived.
        await expect(
            page
                .getByTestId('discover-grid')
                .locator('a[href^="/games/"]:visible, button[aria-label^="Research "]:visible')
                .first(),
        ).toBeVisible({ timeout: 20_000 });

        let filters = await openGamesFilters(page);
        // The panel is up (the genre group renders) but the co-op group is not.
        await expect(filters.getByTestId('genre-filter-group')).toBeVisible();
        await expect(filters.getByTestId(COOP_GROUP)).toHaveCount(0);
        await expect(onlineSlider(filters)).toHaveCount(0);
        await closeGamesFilters(page);

        // The fixture search loads the enriched row — co-op data now exists.
        await searchGames(page, FIXTURE_QUERY);
        await expect(visibleGameLink(page, seed.enrichedGameId)).toBeVisible({ timeout: 15_000 });
        filters = await openCoopControls(page);
        await expect(filters.getByRole('checkbox', { name: 'Split-screen' })).toBeVisible();
    });

    test('an active co-op predicate excludes games with no co-op data', async ({ page }) => {
        await page.goto('/games');
        await searchGames(page, FIXTURE_QUERY);
        await applyOnlineCoopFilter(page, 4);

        // Enriched fixture (online max 4) survives "4+ online players".
        await expect(visibleGameLink(page, seed.enrichedGameId)).toBeVisible({
            timeout: 15_000,
        });
        // Both null-data fixtures are excluded — never silently kept.
        await expect(page.locator(`a[href="/games/${seed.syncedEmptyGameId}"]`)).toHaveCount(0);
        await expect(page.locator(`a[href="/games/${seed.unsyncedGameId}"]`)).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('an active co-op predicate renders the co-op-data hint', async ({ page }) => {
        await page.goto('/games');
        await searchGames(page, FIXTURE_QUERY);
        const filters = await openCoopControls(page);
        // The group is up with no predicate on — so no hint yet.
        await expect(filters.locator(COOP_HINT)).toHaveCount(0);

        await setOnlineMin(page, filters, 4);

        const hint = filters.locator(COOP_HINT);
        await expect(hint).toBeVisible({ timeout: 10_000 });
        await expect(hint).toHaveText(/showing games with co-op data/i);
    });

    test('clearing the co-op predicate restores the excluded games', async ({ page }) => {
        await page.goto('/games');
        await searchGames(page, FIXTURE_QUERY);
        await applyOnlineCoopFilter(page, 4);
        await expect(page.locator(`a[href="/games/${seed.syncedEmptyGameId}"]`)).toHaveCount(0);

        const filters = await openCoopControls(page);
        await expect(filters.locator(COOP_HINT)).toBeVisible();
        await setOnlineMin(page, filters, 0);
        await expect(filters.locator(COOP_HINT)).toHaveCount(0);
        await closeGamesFilters(page);

        await expect(visibleGameLink(page, seed.syncedEmptyGameId)).toBeVisible({
            timeout: 15_000,
        });
        await expect(page.locator(COOP_HINT)).toHaveCount(0);
    });
});
