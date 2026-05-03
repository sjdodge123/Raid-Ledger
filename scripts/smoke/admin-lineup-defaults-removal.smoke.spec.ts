/**
 * TDD smoke tests for ROK-1060 — admin "Lineup Defaults" surface removal.
 *
 * Asserts the NEW desired state: the Lineup Defaults panel, route, and admin
 * sidebar link are GONE. While the feature still exists these tests MUST fail.
 * After dev removes the panel + route + nav entry, both tests should pass.
 *
 * Covers:
 *   - AC-4: admin sidebar no longer contains a "Lineup Defaults" link
 *   - AC-5: /admin/settings/general/lineup no longer renders the panel
 */
import { test, expect } from './base';
import { isMobile } from './helpers';

test.describe('Admin Lineup Defaults removal (ROK-1060)', () => {
    test('navigating to /admin/settings/general/lineup does not render the Lineup Defaults panel', async ({ page }) => {
        await page.goto('/admin/settings/general/lineup');

        // Wait for the admin layout to fully settle. The admin layout renders a
        // <main> element regardless of the active route, and the network goes
        // idle once the (lazy-loaded) child route has resolved. Asserting AFTER
        // both conditions ensures we're not catching the page mid-lazy-load,
        // where the panel hasn't mounted yet.
        await expect(page.locator('main').last()).toBeVisible({ timeout: 15_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

        // No error boundary on the would-be route.
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);

        // Negative assertion: the Lineup Defaults panel-specific heading must
        // NOT be present. The panel renders <h2>Lineup Phase Durations</h2>
        // (see web/src/pages/admin/lineup-defaults-panel.tsx). After removal,
        // the route falls through and this heading should be absent.
        await expect(
            page.getByRole('heading', { name: 'Lineup Phase Durations', level: 2 }),
        ).toHaveCount(0);

        // Belt-and-braces: the panel's per-phase duration sliders carry stable
        // test ids. None should be present after removal.
        await expect(page.getByTestId('default-building-duration')).toHaveCount(0);
        await expect(page.getByTestId('default-voting-duration')).toHaveCount(0);
        await expect(page.getByTestId('default-decided-duration')).toHaveCount(0);
    });

    test('admin sidebar does not contain a "Lineup Defaults" link', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo), 'Desktop-only — admin sidebar hidden on mobile');

        await page.goto('/admin/settings/general');

        const sidebar = page.locator('nav[aria-label="Admin settings navigation"]');
        await expect(sidebar).toBeVisible({ timeout: 15_000 });

        // Confirm the sidebar has rendered its General section by asserting a
        // sibling link is present — keeps the negative assertion below
        // meaningful (we know the nav fully rendered, so a missing link is a
        // real removal, not a slow render).
        await expect(sidebar.getByRole('link', { name: 'Site Settings' })).toBeVisible({
            timeout: 10_000,
        });

        // Negative assertion: no link with the exact text "Lineup Defaults".
        await expect(sidebar.getByRole('link', { name: 'Lineup Defaults', exact: true })).toHaveCount(0);
    });
});
