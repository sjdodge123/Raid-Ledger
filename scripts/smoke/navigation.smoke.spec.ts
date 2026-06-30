/**
 * Navigation smoke tests — nav links, header, console errors.
 * Desktop tests use the header nav; mobile tests use the bottom tab bar.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { isMobile } from './helpers';

/**
 * ROK-1286: gate every route assertion on the layout `<main>` actually being
 * on screen. The app shell renders a stable `#main-content` landmark that wraps
 * each route's content (some pages also render a nested `<main>`, so we target
 * the id to avoid a strict-mode collision). Waiting for it after `networkidle`
 * ensures the route has mounted before we assert on URL / nav links / headings,
 * closing the window where a fast click+goto raced the page mount under the
 * 1–3s of added full-suite latency.
 */
async function waitForMainContent(page: Page): Promise<void> {
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 15_000 });
}

test.describe('Navigation (desktop)', () => {
    test('header contains all main nav links', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — uses header nav');

        await page.goto('/calendar');
        const nav = page.locator('header nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        await expect(nav.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Games' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Events' })).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Players' })).toBeVisible();
    });

    test('nav links navigate to correct pages', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — uses header nav');

        await page.goto('/calendar');
        const nav = page.locator('header nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible({ timeout: 15_000 });

        // ROK-1247: gate each nav-click on URL change + networkidle instead
        // of a heading text match. The previous heading checks raced the nav
        // link text "Events" / "Calendar" / "Players" (all match the heading
        // regex) and useQuery's staleTime could keep the page rendering
        // skeleton chrome with no heading at all. Optional level-1 heading
        // check after the URL match still verifies the page rendered.
        await nav.getByRole('link', { name: 'Events' }).click();
        await expect(page).toHaveURL(/\/events$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: /Events/i }),
        ).toBeVisible({ timeout: 10_000 });

        await nav.getByRole('link', { name: 'Games' }).click();
        await expect(page).toHaveURL(/\/games$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await nav.getByRole('link', { name: 'Players' }).click();
        await expect(page).toHaveURL(/\/players$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: 'Players' }),
        ).toBeVisible({ timeout: 10_000 });

        await nav.getByRole('link', { name: 'Calendar' }).click();
        await expect(page).toHaveURL(/\/calendar$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: 'Calendar' }),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('no critical console errors during navigation', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — Calendar heading hidden on mobile');

        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        // ROK-1247: scope each heading check to level: 1 so it doesn't match
        // the nav link text. networkidle gives useQuery a chance to settle
        // before the heading visibility assertion fires.
        await page.goto('/calendar');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: 'Calendar' }),
        ).toBeVisible({ timeout: 15_000 });

        await page.goto('/events');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        await page.goto('/games');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await page.goto('/players');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: 'Players' }),
        ).toBeVisible({ timeout: 15_000 });

        const criticalErrors = filterBenignErrors(errors);
        expect(criticalErrors).toHaveLength(0);
    });
});

test.describe('Navigation (mobile)', () => {
    test('bottom tab bar contains all main nav links', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — uses bottom tab bar');

        await page.goto('/calendar');
        // Both desktop header nav and bottom tab bar use aria-label="Main navigation".
        // The header nav is hidden on mobile (hidden md:flex); the bottom tab bar
        // renders last in the DOM and is the only visible nav on mobile.
        const tabBar = page.locator('nav[aria-label="Main navigation"]').last();
        await expect(tabBar).toBeVisible({ timeout: 15_000 });

        await expect(tabBar.getByRole('link', { name: 'Calendar' })).toBeVisible();
        await expect(tabBar.getByRole('link', { name: 'Events' })).toBeVisible();
        await expect(tabBar.getByRole('link', { name: 'Games' })).toBeVisible();
        await expect(tabBar.getByRole('link', { name: 'Players' })).toBeVisible();
    });

    test('bottom tab bar links navigate to correct pages', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — uses bottom tab bar');

        await page.goto('/calendar');
        // Bottom tab bar is the fixed nav at the bottom — use the mobile toolbar selector
        const tabBar = page.locator('nav.fixed, nav[aria-label="Main navigation"]').last();
        await expect(tabBar).toBeVisible({ timeout: 15_000 });

        // ROK-1247: assert URL transition + networkidle after each click, then
        // (where useful) a level-1 heading. This avoids the prior race where
        // the bottom-tab link text "Events" matched the heading regex before
        // the page actually mounted. Calendar still uses the mobile-only
        // "Calendar view switcher" gate (the Calendar h1 is hidden on mobile).

        // Use evaluate to click programmatically — bypasses Playwright viewport checks
        const eventsLink = tabBar.getByRole('link', { name: 'Events' });
        await eventsLink.evaluate((el: HTMLElement) => el.click());
        await expect(page).toHaveURL(/\/events$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: /Events/i }).first(),
        ).toBeVisible({ timeout: 10_000 });

        // Navigate to Games
        await tabBar.getByRole('link', { name: 'Games' }).evaluate((el: HTMLElement) => el.click());
        await expect(page).toHaveURL(/\/games$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Navigate to Players
        await tabBar.getByRole('link', { name: 'Players' }).evaluate((el: HTMLElement) => el.click());
        await expect(page).toHaveURL(/\/players$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: 'Players' }),
        ).toBeVisible({ timeout: 10_000 });

        // Navigate back to Calendar — heading is hidden (md:block), use mobile toolbar
        await tabBar.getByRole('link', { name: 'Calendar' }).evaluate((el: HTMLElement) => el.click());
        await expect(page).toHaveURL(/\/calendar$/, { timeout: 10_000 });
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(page.getByLabel('Calendar view switcher')).toBeVisible({ timeout: 10_000 });
    });

    test('no critical console errors during navigation', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only');

        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        // ROK-1247: networkidle + level-1 heading to keep checks deterministic
        // without depending on useQuery's cache being warm.
        // Calendar heading is hidden on mobile — use the mobile toolbar instead
        await page.goto('/calendar');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(page.getByLabel('Calendar view switcher')).toBeVisible({ timeout: 15_000 });

        await page.goto('/events');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: /Events/i }).first(),
        ).toBeVisible({ timeout: 15_000 });

        await page.goto('/games');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await page.goto('/players');
        await page.waitForLoadState('networkidle');
        await waitForMainContent(page);
        await expect(
            page.getByRole('heading', { level: 1, name: 'Players' }),
        ).toBeVisible({ timeout: 15_000 });

        const criticalErrors = filterBenignErrors(errors);
        expect(criticalErrors).toHaveLength(0);
    });

    test('hamburger opens more drawer', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — hamburger menu');

        await page.goto('/calendar');
        await expect(page.getByLabel('Calendar view switcher')).toBeVisible({ timeout: 15_000 });

        // Open the hamburger menu
        await page.getByRole('button', { name: 'Open menu' }).click();

        // The drawer should be visible with expected sections
        const drawer = page.getByTestId('more-drawer-panel');
        await expect(drawer).toBeVisible({ timeout: 5_000 });
        await expect(drawer.getByText('More')).toBeVisible();

        // Close the drawer
        await page.getByRole('button', { name: 'Close menu' }).click();
        await expect(drawer).not.toBeVisible({ timeout: 5_000 });
    });
});

/**
 * Filter out known benign console errors so the "no critical errors" assertion
 * only fails on real application errors.
 *
 * ROK-1286: rapid `goto`/click navigation tears down in-flight `fetch`/query
 * requests and re-lays-out the shell mid-flight, which emits a known set of
 * navigation-race console noise (`AbortError` from cancelled requests,
 * `ResizeObserver loop` warnings) that is NOT an application fault. These were
 * leaking through intermittently on loaded runners and failing the assertion.
 * They are added to the benign allowlist alongside the original network/CORS
 * patterns. The allowlist is still scoped to specific, well-understood strings
 * — a genuine runtime error (e.g. an uncaught TypeError) is NOT matched and
 * still fails the test.
 */
function filterBenignErrors(errors: string[]): string[] {
    return errors.filter(
        (e) =>
            !e.includes('net::') &&
            !e.includes('favicon') &&
            !e.includes('404') &&
            !e.includes('429') &&
            !e.includes('CORS') &&
            !e.includes('ERR_CONNECTION_REFUSED') &&
            !e.includes('Failed to load resource') &&
            !e.includes('AbortError') &&
            !e.includes('aborted') &&
            !e.includes('ResizeObserver'),
    );
}
