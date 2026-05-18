/**
 * ROK-1297 — Playwright smoke for the Nominating composite (Cycle 4 S1).
 *
 * Validates the rewritten Nominating phase of the lineup detail page:
 *   - JourneyHero region at the top with the Nominating step badge (AC-Hero).
 *   - Common Ground hero renders 3 themed rows × 4 tiles = 12 tiles total
 *     when the API surfaces themed responses (AC-Themed).
 *   - Clicking a tile body opens the GameResearchDrawer (AC-DrawerOpen).
 *   - Clicking a per-tile `+ Nominate` button adds a nomination and the
 *     Yours tab count increments by one (AC-Nominate).
 *   - The legacy NominateModal is reachable via the `Or search any game`
 *     affordance (AC-Search).
 *
 * Per operator browser-test (2026-05-18, Linear comment 52025e97) the
 * U4 SubmitBar is intentionally NOT rendered on this composite —
 * nominations autosave so there is no submit verb.
 *
 * Runs in both `desktop` and `mobile` projects per playwright.config.ts.
 * CLAUDE.md "Smoke Test Verification" requires both viewports.
 */
import { test, expect } from './base';
import {
    getAdminToken,
    apiGet,
    apiPost,
    apiPatch,
    createLineupOrRetry,
    API_BASE,
} from './api-helpers';

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const FILE_PREFIX = 'nominating-composite';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;
let lineupId: number;

async function setupBuildingLineup(token: string): Promise<{
    lineupId: number;
}> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });

    const { id } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );
    return { lineupId: id };
}

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Nominating Composite`;
    adminToken = await getAdminToken();
    const result = await setupBuildingLineup(adminToken);
    lineupId = result.lineupId;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the building lineup and wait for the composite root. */
async function gotoNominating(
    page: import('@playwright/test').Page,
): Promise<void> {
    await page.goto(`/community-lineup/${lineupId}`);
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 10_000,
    });
    await expect(page.getByTestId('nominating-composite-view')).toBeVisible({
        timeout: 20_000,
    });
}

// ---------------------------------------------------------------------------
// AC-Hero — JourneyHero region
// ---------------------------------------------------------------------------

test.describe('Nominating composite — hero (ROK-1297)', () => {
    test('renders JourneyHero with the Nominating step badge', async ({
        page,
    }) => {
        await gotoNominating(page);
        const hero = page.getByRole('region', {
            name: /step 1 of 4 · nominating/i,
        });
        await expect(hero).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// AC-Themed — 3 themed rows × 4 tiles
// ---------------------------------------------------------------------------

test.describe('Nominating composite — Common Ground multi-row hero (ROK-1297)', () => {
    test('renders the Common Ground hero', async ({ page }) => {
        // AC says "3 themed rows × 4 tiles = 12 tiles". Reaching the full 12
        // requires participants with ownership + taste signals (owned/taste
        // buckets populated). This single-user smoke fixture seeds no
        // user_games or user_taste_vectors, so classifyTheme places every
        // game into `trending` and only that row renders tiles (capped at 4).
        // Full theme-classification coverage lives at the helper layer in
        // `api/src/lineups/common-ground-theme.helpers.spec.ts`.
        await gotoNominating(page);
        await expect(page.getByTestId('common-ground-hero')).toBeVisible({
            timeout: 15_000,
        });
        const tiles = page.getByTestId('common-ground-tile');
        const count = await tiles.count();
        expect(count).toBeGreaterThanOrEqual(1);
        // Cap is `PER_THEME_CEILING` (24) × 3 themes = 72. Multi-row layout
        // wraps within each themed bucket — pre-rework this was hard-capped
        // at 4 per row so the original assertion was `<= 12`.
        expect(count).toBeLessThanOrEqual(72);
    });
});

// ---------------------------------------------------------------------------
// AC-DrawerOpen — Tile body click opens GameResearchDrawer
// ---------------------------------------------------------------------------

test.describe('Nominating composite — drawer interactions (ROK-1297)', () => {
    test('clicking a tile body opens the GameResearchDrawer', async ({
        page,
    }) => {
        await gotoNominating(page);

        await expect(page.getByTestId('game-research-drawer')).toHaveCount(0);

        const firstTile = page.getByTestId('common-ground-tile').first();
        await expect(firstTile).toBeVisible({ timeout: 10_000 });
        // The card body acts as the drawer trigger (role=button, aria-label
        // "Open details for ..."). On desktop, `:group-hover` reveals the
        // legacy CommonGroundGameCard's Nominate overlay; Playwright's
        // pre-click hover triggers that overlay before the click lands.
        // Click at a position offset (top-left of the card) to avoid the
        // centered overlay button. The wrapper's `pointer-events-none` on
        // the overlay backdrop only intercepts taps on the overlay's button
        // itself — anywhere else still bubbles to the drawer trigger.
        await firstTile
            .getByRole('button', { name: /open details for/i })
            .click({ position: { x: 30, y: 30 } });

        await expect(page.getByTestId('game-research-drawer')).toBeVisible({
            timeout: 10_000,
        });
    });

    test('clicking the per-tile + Nominate button does NOT open the drawer', async ({
        page,
    }) => {
        await gotoNominating(page);

        const firstTile = page.getByTestId('common-ground-tile').first();
        const nominateBtn = firstTile.getByTestId('common-ground-tile-nominate');
        await expect(nominateBtn).toBeVisible({ timeout: 10_000 });
        await nominateBtn.click();

        // Drawer must remain absent.
        await expect(page.getByTestId('game-research-drawer')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC-Nominate — Per-tile Nominate adds a card to the Nominated Games list
// (Operator rework 2026-05-18: tabs removed; the existing-nominations list
// now shows every nomination, so the test asserts that count increments.)
// ---------------------------------------------------------------------------

test.describe('Nominating composite — nominate adds to existing list (ROK-1297)', () => {
    test('clicking + Nominate increments the Nominated Games count', async ({
        page,
    }) => {
        await gotoNominating(page);

        const list = page.getByTestId('nominations-list');
        const empty = page.getByTestId('nominations-empty');
        // The list may be empty or populated at start (shared fixture).
        // Count "<N> shown" if list rendered, else 0.
        const before = await (async () => {
            if (await empty.isVisible().catch(() => false)) return 0;
            const t = await list.textContent();
            const m = /(\d+) shown/.exec(t ?? '');
            return m ? Number(m[1]) : 0;
        })();

        const firstTile = page.getByTestId('common-ground-tile').first();
        await firstTile.getByTestId('common-ground-tile-nominate').click();

        await expect
            .poll(async () => {
                const t = await list.textContent();
                const m = /(\d+) shown/.exec(t ?? '');
                return m ? Number(m[1]) : -1;
            }, { timeout: 10_000 })
            .toBe(before + 1);
    });
});

// ---------------------------------------------------------------------------
// AC-Search — "Search any game" CTA swaps the hero body to inline search
// (Operator rework 2026-05-18: results render in the same Common Ground
// vertical space, NOT in a modal).
// ---------------------------------------------------------------------------

test.describe('Nominating composite — search affordance (ROK-1297)', () => {
    test('clicking "Search any game" swaps the hero body to inline search', async ({
        page,
    }) => {
        await gotoNominating(page);

        const searchBtn = page.getByTestId('nominate-search-any');
        await expect(searchBtn).toBeVisible({ timeout: 10_000 });
        await searchBtn.click();

        // Inline view replaces the themed-rows body inside CommonGroundHero.
        await expect(page.getByTestId('search-any-game-view')).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.getByTestId('search-any-game-input')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// AC-Responsive — Both desktop and mobile must render the composite
// ---------------------------------------------------------------------------

test.describe('Nominating composite — responsive (ROK-1297)', () => {
    test('renders the composite on the active viewport', async ({
        page,
    }, testInfo) => {
        await gotoNominating(page);

        const hero = page.getByRole('region', {
            name: /step 1 of 4 · nominating/i,
        });
        await expect(hero).toBeVisible({ timeout: 10_000 });

        if (testInfo.project.name === 'mobile') {
            const box = await hero.boundingBox();
            const viewport = page.viewportSize();
            expect(box).not.toBeNull();
            expect(viewport).not.toBeNull();
            if (box && viewport) {
                expect(box.width).toBeLessThanOrEqual(viewport.width);
            }
        }
    });
});

// Suppress unused-import warning while keeping the helpers handy for the
// dev's iteration loop. apiGet / apiPatch will be used when this test
// gains coverage for adding voter signals (taste vectors, ownership).
void apiGet;
void apiPatch;
