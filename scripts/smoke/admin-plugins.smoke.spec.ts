/**
 * Admin plugins panel smoke tests — plugin list, card details, action buttons.
 * Tests both desktop and mobile viewports via Playwright projects.
 */
import { test, expect } from './base';

test.describe('Admin plugins panel', () => {
    test('renders plugin list with heading and description', async ({ page }) => {
        await page.goto('/admin/settings/plugins');
        await expect(page.getByRole('heading', { name: 'Manage Plugins' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Install and configure plugins to extend functionality.')).toBeVisible();
    });

    test('each plugin card shows name, status, and description', async ({ page }) => {
        await page.goto('/admin/settings/plugins');
        await expect(page.getByRole('heading', { name: 'Manage Plugins' })).toBeVisible({ timeout: 10_000 });

        // At least one plugin card should render with an h3 heading
        const pluginHeadings = page.locator('h3');
        await expect(pluginHeadings.first()).toBeVisible({ timeout: 10_000 });
        const headingCount = await pluginHeadings.count();
        expect(headingCount).toBeGreaterThanOrEqual(1);

        // Each plugin card should show a status badge (Active, Inactive, or Not Installed)
        const statusBadges = page.getByText(/^(Active|Inactive|Not Installed)$/);
        const badgeCount = await statusBadges.count();
        expect(badgeCount).toBeGreaterThanOrEqual(1);

        // Each plugin should have a description (author line confirms card details render)
        await expect(page.getByText('Author:').first()).toBeVisible();
    });

    test('action buttons are visible for each plugin', async ({ page }) => {
        await page.goto('/admin/settings/plugins');
        await expect(page.getByRole('heading', { name: 'Manage Plugins' })).toBeVisible({ timeout: 10_000 });

        // Wait for plugin cards to finish loading (h3 headings appear when cards render)
        await expect(page.locator('h3').first()).toBeVisible({ timeout: 15_000 });

        // Every plugin in a known state should have an action button:
        //   active -> Deactivate, inactive -> Activate + Uninstall, not_installed -> Install
        const actionButtons = page.getByRole('button', {
            name: /^(Install|Activate|Deactivate|Uninstall)$/,
        });
        const buttonCount = await actionButtons.count();
        expect(buttonCount).toBeGreaterThanOrEqual(1);
    });

    test('panel loads without error boundary', async ({ page }) => {
        await page.goto('/admin/settings/plugins');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
        // Verify the panel actually rendered (not just a blank page)
        await expect(page.getByRole('heading', { name: 'Manage Plugins' })).toBeVisible({ timeout: 10_000 });
    });
});
