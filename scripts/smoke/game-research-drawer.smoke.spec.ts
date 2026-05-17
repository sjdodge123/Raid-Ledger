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
import { test, expect } from './base';

const DRAWER_TESTID = 'game-research-drawer';
const DRAWER_BACKDROP_TESTID = 'game-research-drawer-backdrop';
const DRAWER_CLOSE_TESTID = 'game-research-drawer-close';
const DRAWER_CTA_TESTID = 'game-research-drawer-cta';
const GAMEREF_ROW_TESTID = 'game-ref-row';
const INFO_AFFORDANCE_TESTID = 'game-ref-info-affordance';

/**
 * Open the Games index page and wait for the GameCarousel surface to render.
 * Desktop and mobile use different trigger affordances per operator decision:
 *   - Desktop (≥md): UnifiedGameCard with Link → /games/:id + an ⓘ overlay
 *     button (data-testid="game-ref-info-affordance") that is the ONLY drawer
 *     trigger. Card body click still navigates.
 *   - Mobile (<md): DrawerCard with whole-button → drawer (data-testid="game-ref-row").
 */
async function gotoGamesAndWaitForRows(
    page: import('@playwright/test').Page,
    project: 'desktop' | 'mobile',
): Promise<void> {
    await page.goto('/games');
    await expect(firstVisibleDrawerTrigger(page, project)).toBeVisible({ timeout: 15_000 });
}

function firstVisibleDrawerTrigger(
    page: import('@playwright/test').Page,
    project: 'desktop' | 'mobile',
) {
    const testid = project === 'desktop' ? INFO_AFFORDANCE_TESTID : GAMEREF_ROW_TESTID;
    return page.locator(`[data-testid="${testid}"]:visible`).first();
}

test.describe('Game Research Drawer — desktop', () => {
    test.beforeEach(({}, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only assertions');
    });

    test('clicking a GameRef row opens the research drawer in-place (no navigation)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "desktop");
        const urlBeforeClick = page.url();

        await firstVisibleDrawerTrigger(page, "desktop").click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible({ timeout: 5_000 });
        expect(page.url()).toBe(urlBeforeClick);
    });

    test('Escape key closes the drawer', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "desktop");
        await firstVisibleDrawerTrigger(page, "desktop").click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });

    test('outside-click on backdrop closes the drawer', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "desktop");
        await firstVisibleDrawerTrigger(page, "desktop").click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.getByTestId(DRAWER_BACKDROP_TESTID).click({ position: { x: 5, y: 5 } });
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });

    test('dedicated close button (X) closes the drawer', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "desktop");
        await firstVisibleDrawerTrigger(page, "desktop").click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.getByTestId(DRAWER_CLOSE_TESTID).click();
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });

    test('drawer is a labelled dialog (role=dialog + aria-modal)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "desktop");
        await firstVisibleDrawerTrigger(page, "desktop").click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();
        await expect(drawer).toHaveAttribute('role', 'dialog');
        await expect(drawer).toHaveAttribute('aria-modal', 'true');
        await expect(drawer).toHaveAttribute('aria-label', /.+/);
    });

    test('inline action button does NOT trigger drawer (whole row is the trigger except action)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "desktop");
        const row = firstVisibleDrawerTrigger(page, "desktop");
        const inlineAction = row.getByTestId('game-ref-row-action');
        const present = await inlineAction.isVisible({ timeout: 3_000 }).catch(() => false);
        test.skip(!present, 'Demo integration row has no inline action — skip click-area discrimination');

        await inlineAction.click();
        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeHidden();
    });

    test('drawer CTA fires without navigating (action commits in-page)', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "desktop");
        await firstVisibleDrawerTrigger(page, "desktop").click();

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
        await gotoGamesAndWaitForRows(page, "mobile");
        await firstVisibleDrawerTrigger(page, "mobile").click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible({ timeout: 5_000 });

        // Measure the inner panel (the actual sized box), not the fixed inset-0 dialog wrapper.
        const panel = page.getByTestId('game-research-drawer-panel');
        const panelBox = await panel.boundingBox();
        const viewportSize = page.viewportSize();
        if (!panelBox || !viewportSize) {
            throw new Error('Could not measure drawer panel or viewport');
        }
        // Bottom-sheet contract: panel bottom edge flush with viewport bottom
        // (2px sub-pixel rounding tolerance) AND panel height capped at ~85vh
        // (mobile bottom-sheet convention — never covers the full viewport).
        expect(panelBox.y + panelBox.height).toBeGreaterThanOrEqual(viewportSize.height - 2);
        expect(panelBox.height).toBeLessThanOrEqual(viewportSize.height * 0.85 + 2);
        expect(panelBox.y).toBeGreaterThan(0);
    });

    test('mobile drawer closes on outside tap', async ({ page }) => {
        await gotoGamesAndWaitForRows(page, "mobile");
        await firstVisibleDrawerTrigger(page, "mobile").click();

        const drawer = page.getByTestId(DRAWER_TESTID);
        await expect(drawer).toBeVisible();

        await page.getByTestId(DRAWER_BACKDROP_TESTID).tap({ position: { x: 5, y: 5 } });
        await expect(drawer).toBeHidden({ timeout: 5_000 });
    });
});
