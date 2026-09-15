/**
 * Shared helpers for Playwright smoke tests.
 */
import { expect, type TestInfo, type Page, type Locator } from '@playwright/test';

/** Returns true when the current project is the desktop viewport. */
export function isDesktop(testInfo: TestInfo): boolean {
    return testInfo.project.name === 'desktop';
}

/** Returns true when the current project is the mobile viewport. */
export function isMobile(testInfo: TestInfo): boolean {
    return testInfo.project.name === 'mobile';
}

/**
 * Dismiss whichever game-time check shell is on screen (ROK-1569).
 *
 * Above 768px that is still the desktop Modal, whose body is
 * `game-time-check-body` and whose Skip answer is `game-time-check-skip`.
 * BELOW 768px step 1 is now the phone week editor inside the two-step
 * BottomSheet, so `game-time-check-body` no longer exists there and a probe
 * that only knows the old testid degrades into a silent no-op — the sheet then
 * sits over the composite and every later click is intercepted.
 *
 * On the phone we close the SHEET rather than tapping its Skip: tapping Skip on
 * step 1 ends the check but the sheet stays up showing step 2 (the ballot —
 * ROK-1574), which is exactly the overlay we are trying to get out of the way.
 * The sheet's close control on step 1 IS the session skip (`GameTimeCheckSheet`
 * `handleClose` calls `onClose` → `gate.skip`), so the sessionStorage
 * persistence the callers rely on is unchanged.
 */
export async function dismissGameTimeCheck(page: Page): Promise<void> {
    // Both shells mount from the scheduling composite (ROK-1574), and the
    // gate's game-time query starts when the composite mounts — so probe only
    // AFTER the composite (or the terminal badge) is on screen. Probing from
    // `domcontentloaded` raced the query on a loaded runner: the 1.5s probe
    // missed, the full-height sheet then landed over the page and every later
    // click was "intercepted" (ROK-1569 gate, 2026-09-15).
    await page
        .locator('[data-testid="scheduling-composite"], [data-testid="match-status-badge"]')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .catch(() => {});

    const body = page.getByTestId('game-time-check-body');
    const sheet = page.getByTestId('game-time-check-sheet');
    const shell = body.or(sheet).first();
    if (!(await shell.isVisible({ timeout: 3_000 }).catch(() => false))) return;

    if (await body.isVisible().catch(() => false)) {
        // Desktop modal (or the ROK-1564 body on any shell): Skip is the answer.
        await page.getByTestId('game-time-check-skip').click();
        await expect(body).toBeHidden({ timeout: 10_000 });
        return;
    }
    // Phone sheet: the body's Skip ADVANCES to step 2 by design, so Close is
    // the dismiss (its step-1 branch is the session skip).
    await page.getByRole('button', { name: 'Close sheet' }).click();
    await expect(sheet).toBeHidden({ timeout: 10_000 });
}

/**
 * Expand the local login form if OAuth providers (Discord) are shown.
 * Waits for the login page to load, then clicks the toggle to reveal
 * username/password fields if they're hidden behind an OAuth-first layout.
 */
export async function expandLocalLogin(page: Page) {
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    const toggleBtn = page.getByText('Sign in with username instead');
    if (await toggleBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await toggleBtn.click();
        await expect(page.locator('#username')).toBeVisible({ timeout: 5_000 });
    }
}

/**
 * Navigate to the first event detail page.
 * Handles desktop vs mobile navigation — desktop uses the grid cards,
 * mobile uses data-testid mobile cards.
 */
export async function navigateToFirstEvent(page: Page, testInfo: TestInfo) {
    await page.goto('/events');

    if (isMobile(testInfo)) {
        const eventCard = page.locator('[data-testid="mobile-event-card"]').first();
        await expect(eventCard).toBeVisible({ timeout: 10_000 });
        await eventCard.click();
    } else {
        const firstEventCard = page.locator('.hidden.md\\:grid [role="button"]').first();
        await expect(firstEventCard).toBeVisible({ timeout: 10_000 });
        await firstEventCard.click();
    }

    await page.waitForURL(/\/events\/\d+/, { timeout: 10_000 });
}

/**
 * Navigate to `url`, settle the network, then wait for a real data-loaded
 * element before returning — a deterministic alternative to navigating and
 * immediately asserting (which races the client query's first resolve).
 *
 * `networkidle` is `.catch()`'d on purpose: pages with long-poll/SSE
 * subscriptions (lineup detail, tiebreaker views) never reach networkidle,
 * so the `readyLocator` visibility is the authoritative readiness signal.
 */
export async function gotoAndWaitForData(
    page: Page,
    url: string,
    readyLocator: Locator,
    timeout = 15_000,
): Promise<void> {
    await page.goto(url);
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
    await expect(readyLocator).toBeVisible({ timeout });
}
