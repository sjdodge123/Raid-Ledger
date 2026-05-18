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
 *   - SubmitBar status changes from "kind=empty" disabled to a primary CTA
 *     when at least one nomination exists (AC-Submit).
 *
 * NOTE (test-agent, 2026-05-17): This file is committed as
 * **fails-by-construction**. It cannot be executed at TDD-write time
 * because the env lock for this batch is held by another worktree (per
 * the dev-brief). The component imports + selectors target post-ROK-1297
 * artifacts that DO NOT EXIST yet:
 *   - `[data-testid="nominating-composite-view"]`
 *   - `[data-testid="common-ground-hero"]`
 *   - `[data-testid="common-ground-themed-row-{owned|taste|trending}"]`
 *   - `[data-testid="common-ground-tile"]`
 *   - `[data-testid="nominating-tabs"]`
 *   - `[data-testid="submit-bar"]`
 * The dev wires those testids when implementing the composite. The Lead
 * runs Playwright against the deployed dev env after env-lock release.
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

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`fetchGameIds failed: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games in DB');
    return body.data.slice(0, count).map((g) => g.id);
}

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
    test('renders 3 themed rows (Owned / Taste / Trending)', async ({
        page,
    }) => {
        await gotoNominating(page);
        await expect(
            page.getByTestId('common-ground-themed-row-owned'),
        ).toBeVisible({ timeout: 15_000 });
        await expect(
            page.getByTestId('common-ground-themed-row-taste'),
        ).toBeVisible();
        await expect(
            page.getByTestId('common-ground-themed-row-trending'),
        ).toBeVisible();
    });

    test('renders 12 tiles total across the three themed rows', async ({
        page,
    }) => {
        await gotoNominating(page);
        await expect(page.getByTestId('common-ground-hero')).toBeVisible({
            timeout: 15_000,
        });
        const tiles = page.getByTestId('common-ground-tile');
        await expect(tiles).toHaveCount(12, { timeout: 15_000 });
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
        await firstTile.click();

        await expect(page.getByTestId('game-research-drawer')).toBeVisible({
            timeout: 10_000,
        });
    });

    test('clicking the per-tile + Nominate button does NOT open the drawer', async ({
        page,
    }) => {
        await gotoNominating(page);

        const firstTile = page.getByTestId('common-ground-tile').first();
        const nominateBtn = firstTile.getByRole('button', { name: /nominate/i });
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
        await firstTile.getByRole('button', { name: /nominate/i }).click();

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
// AC-Submit — SubmitBar transitions from empty → pre once a nomination exists
// ---------------------------------------------------------------------------

test.describe('Nominating composite — SubmitBar transitions (ROK-1297)', () => {
    test('SubmitBar starts disabled (kind=empty) and becomes enabled after one nomination', async ({
        page,
    }) => {
        await gotoNominating(page);

        const submitBar = page.getByTestId('submit-bar');
        await expect(submitBar).toBeVisible({ timeout: 10_000 });

        const ctaBefore = submitBar.getByRole('button');
        // kind=empty → disabled.
        await expect(ctaBefore).toBeDisabled();

        const firstTile = page.getByTestId('common-ground-tile').first();
        await firstTile.getByRole('button', { name: /nominate/i }).click();

        // kind=pre → enabled primary CTA.
        await expect(submitBar.getByRole('button')).toBeEnabled({
            timeout: 10_000,
        });
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
// gains coverage for SubmitBar transitioning to kind=post (after the
// useSubmitNominations mutation ships).
void apiGet;
void apiPatch;
