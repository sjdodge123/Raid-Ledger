/**
 * Games page smoke tests — page load, mobile card spacing, mobile search styling,
 * co-op FilterPanel (ROK-1402).
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { getAdminToken, apiGet, apiPost, pollForCondition } from './api-helpers';

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
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test');

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
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test');

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
// ROK-1402 — co-op filters on the games library page (FilterPanel)
//
// TDD: written before the implementation. Prescribed surface, matching the
// Players-page FilterPanel precedent:
//   • `FilterPanelTrigger` (aria-label "Filters") on the discover tab —
//     distinct from the existing "Genre Filter" FAB.
//   • Online-players predicate: a range slider, aria-label "Min online players"
//     (0 = "Any"/inactive).
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
// Every test searches for the fixtures BEFORE touching the filter. The section
// is fully dormant until some loaded game carries co-op data, and the seeded
// fixtures reach the page through search rather than the curated discover rows,
// so the search is what activates the trigger on a demo-seeded library. It also
// keeps AC2 honest: the predicate and the query must intersect.
//
// The Co-Optimus HTTP user-agent is deliberately never referenced here.
// ---------------------------------------------------------------------------

const COOP_HINT = '[data-testid="coop-filter-hint"]';
const FIXTURE_QUERY = 'ROK-1398 Co-Op';

type CooptimusSeed = {
    enrichedGameId: number;
    syncedEmptyGameId: number;
    unsyncedGameId: number;
    cooptimusUrl: string;
};

/**
 * Open the co-op FilterPanel, set the online-players predicate, then dismiss the
 * panel. The control is a range slider (operator review 2026-08-20), which
 * `fill()` cannot drive — Home parks it at the minimum and each ArrowRight steps
 * it up by one, both of which fire the real input events React listens for.
 * `minPlayers: 0` therefore clears the predicate.
 */
async function applyOnlineCoopFilter(page: Page, minPlayers: number): Promise<void> {
    await page.getByRole('button', { name: /^filters$/i }).click();
    const slider = page.getByLabel(/min online players/i);
    await expect(slider).toBeVisible({ timeout: 10_000 });
    await slider.focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < minPlayers; i++) await page.keyboard.press('ArrowRight');
    // Closes the panel (BottomSheet on mobile, the inline panel on desktop) so
    // the results underneath are clickable.
    await page.keyboard.press('Escape');
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

test.describe('Games page — co-op FilterPanel (ROK-1402)', () => {
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

    test('the co-op filter trigger appears once co-op data is loaded', async ({ page }) => {
        await page.goto('/games');
        await searchGames(page, FIXTURE_QUERY);

        await expect(page.getByRole('button', { name: /^filters$/i })).toBeVisible({
            timeout: 15_000,
        });
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
        await expect(page.locator(COOP_HINT)).toHaveCount(0);

        await applyOnlineCoopFilter(page, 4);

        const hint = page.locator(COOP_HINT);
        await expect(hint).toBeVisible({ timeout: 10_000 });
        await expect(hint).toHaveText(/showing games with co-op data/i);
    });

    test('clearing the co-op predicate restores the excluded games', async ({ page }) => {
        await page.goto('/games');
        await searchGames(page, FIXTURE_QUERY);
        await applyOnlineCoopFilter(page, 4);
        await expect(page.locator(`a[href="/games/${seed.syncedEmptyGameId}"]`)).toHaveCount(0);

        await applyOnlineCoopFilter(page, 0);

        await expect(visibleGameLink(page, seed.syncedEmptyGameId)).toBeVisible({
            timeout: 15_000,
        });
        await expect(page.locator(COOP_HINT)).toHaveCount(0);
    });
});
