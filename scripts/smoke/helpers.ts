/**
 * Shared helpers for Playwright smoke tests.
 */
import { expect, type TestInfo, type Page } from '@playwright/test';

/** Returns true when the current project is the desktop viewport. */
export function isDesktop(testInfo: TestInfo): boolean {
    return testInfo.project.name === 'desktop';
}

/** Returns true when the current project is the mobile viewport. */
export function isMobile(testInfo: TestInfo): boolean {
    return testInfo.project.name === 'mobile';
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
