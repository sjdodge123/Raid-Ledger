/**
 * Shared helpers for Playwright smoke tests.
 */
import { expect, type TestInfo, type Page, type Locator } from '@playwright/test';

/** Returns true when the current project is the desktop viewport. */
export function isDesktop(testInfo: TestInfo): boolean {
    return testInfo.project.name === 'desktop';
}

/** Returns true when the current project is the phone viewport (Pixel 5). */
export function isMobile(testInfo: TestInfo): boolean {
    return testInfo.project.name === 'mobile';
}

/** Returns true when the current project is the tablet viewport (iPad). */
export function isTablet(testInfo: TestInfo): boolean {
    return testInfo.project.name === 'tablet';
}

/**
 * Returns true when the current project renders the PHONE layout (ROK-1584).
 *
 * Since ROK-1584 the phone/desktop switch sits at 1024px, so the tablet
 * project (iPad, 810px in portrait) gets the bottom sheets and single-column
 * ladders the phone gets — not the desktop sidebars and dropdowns. Any
 * "desktop-only" skip must therefore test THIS, not `isMobile`, or it runs a
 * desktop assertion against a phone layout on the tablet project.
 */
export function isPhoneLayout(testInfo: TestInfo): boolean {
    return !isDesktop(testInfo);
}

/**
 * Dismiss whichever game-time check shell is on screen (ROK-1569 / ROK-1579).
 *
 * Above 1024px that is still the desktop Modal, whose body is
 * `game-time-check-body` and whose Skip answer is `game-time-check-skip`.
 * BELOW 1024px the check is the phone week editor inside the BottomSheet, so
 * `game-time-check-body` no longer exists there and a probe that only knows
 * the old testid degrades into a silent no-op — the sheet then sits over the
 * composite and every later click is intercepted.
 *
 * On the phone we close the SHEET. Since ROK-1579 the sheet is ONE view and
 * both controls collapse the drawer (Skip and the × take the identical path —
 * `GameTimeCheckSheet.handleClose` → `onClose` → `gate.skip`), so either would
 * do; the close stays because it needs no knowledge of which answers the body
 * happens to render. The sessionStorage persistence callers rely on is
 * unchanged.
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
    // Phone sheet (ROK-1579: one view): Close collapses the drawer and IS the
    // session skip. `phone-week-skip` now does exactly the same thing.
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
