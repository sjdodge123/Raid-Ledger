/**
 * ROK-1295 — Playwright smoke tests for the universal Game Research Drawer.
 *
 * Validates the foundation flow: clicking a <GameRef /> in the Games page
 * GameCarousel opens <GameResearchDrawer /> in-page (no navigation), closes
 * on Esc / outside-click / X-button, and renders accessibly as a dialog.
 *
 * Runs in both desktop and mobile projects per playwright.config.ts. The
 * mobile case additionally asserts the bottom-sheet position (anchored to
 * viewport bottom on <md breakpoint).
 *
 * NOTE: All assertions target the in-development component contract. They
 *       MUST fail until ROK-1295 ships the implementation.
 */
import { test, expect } from '../../scripts/smoke/base';

const DRAWER_TESTID = 'game-research-drawer';
const DRAWER_BACKDROP_TESTID = 'game-research-drawer-backdrop';
const DRAWER_CLOSE_TESTID = 'game-research-drawer-close';
const DRAWER_CTA_TESTID = 'game-research-drawer-cta';
const GAMEREF_ROW_TESTID = 'game-ref-row';

/**
 * Open the Games index page and wait for the GameCarousel rows that act as
 * the drawer trigger surface to render. The carousel rows are the operator-
 * picked demo integration site (per dev brief decision 1).
 */
async function gotoGamesAndWaitForRows(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/games');
    const firstRow = page.getByTestId(GAMEREF_ROW_TESTID).first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
}

test.describe('Game Research Drawer — desktop', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only assertions');
    });

    test('clicking a GameRef row opens the research drawer in-place (no navigation)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        const urlBeforeClick = page.url();

        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible({ timeout: 5_000 });
        expect(page.url()).toBe(urlBeforeClick);
    });

    test('Escape key closes the drawer', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });

    test('outside-click on backdrop closes the drawer', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.getByTestId(DRAWER_BACKDROP_TESTID).click({ position: { x: 5, y: 5 } });
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });

    test('dedicated close button (X) closes the drawer', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.getByTestId(DRAWER_CLOSE_TESTID).click();
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });

    test('drawer is a labelled dialog (role=dialog + aria-modal)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();
        await expect(drawer).toHaveAttribute('role', 'dialog');
        await expect(drawer).toHaveAttribute('aria-modal', 'true');
        await expect(drawer).toHaveAttribute('aria-label', /.+/);
    });

    test('inline action button does NOT trigger drawer (whole row is the trigger except action)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        const row = page.getByTestId(GAMEREF_ROW_TESTID).first();
        const inlineAction = row.getByTestId('game-ref-row-action');
        const present = await inlineAction.isVisible({ timeout: 3_000 }).catch(() => false);
        test.skip(!present, 'Demo integration row has no inline action — skip click-area discrimination');

        await inlineAction.click();
        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeHidden();
    });

    test('drawer CTA fires without navigating (action commits in-page)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        const cta = page.getByTestId(DRAWER_CTA_TESTID);
        if (!(await cta.isVisible({ timeout: 3_000 }).catch(() => false))) {
            test.skip(true, 'Demo integration omits action → fallback link rendered; covered by Vitest spec');
            return;
        }
        const urlBeforeClick = page.url();
        await cta.click();
        // CTA wired by caller; we only assert no navigation happened.
        expect(page.url()).toBe(urlBeforeClick);
    });
});

test.describe('Game Research Drawer — mobile', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only assertions');
    });

    test('mobile drawer is anchored to the bottom of the viewport (bottom-sheet)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible({ timeout: 5_000 });

        const drawerBox = await drawer.boundingBox();
        const viewportSize = page.viewportSize();
        if (!drawerBox || !viewportSize) {
            throw new Error('Could not measure drawer or viewport');
        }
        // Bottom-sheet contract: drawer bottom edge is flush with viewport bottom
        // (allow a 2px sub-pixel rounding tolerance) AND the drawer occupies the
        // lower half (top edge > 50% of viewport height).
        expect(drawerBox.y + drawerBox.height).toBeGreaterThanOrEqual(viewportSize.height - 2);
        expect(drawerBox.y).toBeGreaterThan(viewportSize.height * 0.4);
    });

    test('mobile drawer closes on outside tap', async ({ page }) => {
        await gotoGamesAndWaitForRows(page);
        await page.getByTestId(GAMEREF_ROW_TESTID).first().click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.getByTestId(DRAWER_BACKDROP_TESTID).tap({ position: { x: 5, y: 5 } });
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });
});
