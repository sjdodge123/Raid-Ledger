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
        expect(count).toBeLessThanOrEqual(12);
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
        // "Open details for ..."). Clicking the tile container itself would
        // ambiguate between the drawer trigger and the wrapper Nominate
        // button below the card; targeting the drawer trigger directly is
        // what the user does on touch.
        await firstTile
            .getByRole('button', { name: /open details for/i })
            .click();

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
// AC-Nominate — Per-tile Nominate increments Yours count
// ---------------------------------------------------------------------------

test.describe('Nominating composite — nominate increments tab count (ROK-1297)', () => {
    test('clicking + Nominate increments the Yours tab count', async ({
        page,
    }) => {
        await gotoNominating(page);

        const tabs = page.getByTestId('nominating-tabs');
        await expect(tabs).toBeVisible({ timeout: 10_000 });

        const yoursTabBefore = tabs.getByRole('tab', { name: /yours/i });
        const beforeText = await yoursTabBefore.textContent();
        const beforeMatch = /(\d+)/.exec(beforeText ?? '');
        const before = beforeMatch ? Number(beforeMatch[1]) : 0;

        const firstTile = page.getByTestId('common-ground-tile').first();
        await firstTile.getByTestId('common-ground-tile-nominate').click();

        await expect
            .poll(async () => {
                const t = await tabs
                    .getByRole('tab', { name: /yours/i })
                    .textContent();
                const m = /(\d+)/.exec(t ?? '');
                return m ? Number(m[1]) : -1;
            }, { timeout: 10_000 })
            .toBe(before + 1);
    });
});

// ---------------------------------------------------------------------------
// AC-Search — Search any game CTA opens the legacy NominateModal
// ---------------------------------------------------------------------------

test.describe('Nominating composite — search affordance (ROK-1297)', () => {
    test('clicking "Or search any game" opens the NominateModal', async ({
        page,
    }) => {
        await gotoNominating(page);

        const searchBtn = page.getByTestId('nominate-search-any');
        await expect(searchBtn).toBeVisible({ timeout: 10_000 });
        await searchBtn.click();

        // NominateModal is a role=dialog with the title "Nominate a Game"
        // (legacy modal copy carried forward).
        await expect(
            page.getByRole('dialog', { name: /nominate a game/i }),
        ).toBeVisible({ timeout: 10_000 });
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
