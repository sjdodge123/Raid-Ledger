/**
 * Admin general settings smoke tests — General, Roles, and Demo Data panels.
 * Verifies panels render expected content at both desktop and mobile viewports.
 * Admin auth is provided by the shared storageState (global setup).
 *
 * IMPORTANT: Tests never click destructive buttons (Delete, Reset, Clear).
 */
import { test, expect } from '@playwright/test';
import { isMobile } from './helpers';

// ---------------------------------------------------------------------------
// General panel (/admin/settings/general)
// ---------------------------------------------------------------------------

test.describe('Admin General panel', () => {
    test('renders site settings heading and timezone selector', async ({ page }) => {
        await page.goto('/admin/settings/general');

        await expect(
            page.getByRole('heading', { name: 'Site Settings', level: 2 }),
        ).toBeVisible({ timeout: 15_000 });

        await expect(
            page.getByRole('heading', { name: 'Default Timezone', level: 3 }),
        ).toBeVisible({ timeout: 10_000 });

        // Timezone combobox is present with options
        const timezoneSelect = page.getByRole('combobox').first();
        await expect(timezoneSelect).toBeVisible({ timeout: 5_000 });
    });

    test('renders community name and branding sections', async ({ page }) => {
        await page.goto('/admin/settings/general');

        await expect(
            page.getByRole('heading', { name: 'Community Name', level: 3 }),
        ).toBeVisible({ timeout: 15_000 });

        // Community name input is present
        const nameInput = page.getByRole('textbox', { name: 'Raid Ledger' });
        await expect(nameInput).toBeVisible({ timeout: 5_000 });

        await expect(
            page.getByRole('heading', { name: 'Community Logo', level: 3 }),
        ).toBeVisible();

        await expect(
            page.getByRole('heading', { name: 'Accent Color', level: 3 }),
        ).toBeVisible();

        // Save/Reset branding buttons are present (do NOT click Reset)
        await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Reset to Defaults' })).toBeVisible();
    });

    test('renders setup wizard section', async ({ page }) => {
        await page.goto('/admin/settings/general');

        await expect(
            page.getByRole('heading', { name: 'Setup Wizard', level: 3 }),
        ).toBeVisible({ timeout: 15_000 });

        await expect(
            page.getByRole('button', { name: 'Re-run Setup Wizard' }),
        ).toBeVisible();
    });

    test('no error boundary on load', async ({ page }) => {
        await page.goto('/admin/settings/general');
        await expect(
            page.getByRole('heading', { name: 'Site Settings', level: 2 }),
        ).toBeVisible({ timeout: 15_000 });

        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Roles panel (/admin/settings/general/roles)
// ---------------------------------------------------------------------------

test.describe('Admin Roles panel', () => {
    test('renders user management heading and search', async ({ page }) => {
        await page.goto('/admin/settings/general/roles');

        await expect(
            page.getByRole('heading', { name: 'User Management', level: 2 }),
        ).toBeVisible({ timeout: 15_000 });

        // Search input is present
        const searchInput = page.getByPlaceholder('Search users...');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });
    });

    test('renders user list with role dropdowns and total count', async ({ page }) => {
        await page.goto('/admin/settings/general/roles');

        await expect(
            page.getByRole('heading', { name: 'User Management', level: 2 }),
        ).toBeVisible({ timeout: 15_000 });

        // At least one role dropdown (Member/Operator) is visible
        const roleDropdown = page.getByRole('combobox').first();
        await expect(roleDropdown).toBeVisible({ timeout: 10_000 });

        // Total user count is shown (e.g. "105 users")
        await expect(page.getByText(/\d+ users/)).toBeVisible({ timeout: 10_000 });
    });

    test('no error boundary on load', async ({ page }) => {
        await page.goto('/admin/settings/general/roles');
        await expect(
            page.getByRole('heading', { name: 'User Management', level: 2 }),
        ).toBeVisible({ timeout: 15_000 });

        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Demo Data panel (/admin/settings/general/data)
// ---------------------------------------------------------------------------

test.describe('Admin Demo Data panel', () => {
    test('renders demo data heading and status', async ({ page }) => {
        await page.goto('/admin/settings/general/data');

        await expect(
            page.getByRole('heading', { name: 'Demo Data', level: 2 }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // Status badge shows either "Installed" or "Empty"
        const statusBadge = page.getByText(/Installed|Empty/);
        await expect(statusBadge).toBeVisible({ timeout: 10_000 });
    });

    test('renders data count badges when demo data is installed', async ({ page }) => {
        await page.goto('/admin/settings/general/data');

        // Wait for status to settle — badge shows "Installed" or "Empty" once loaded
        const statusBadge = page.getByText(/Installed|Empty/);
        await expect(statusBadge).toBeVisible({ timeout: 15_000 });

        const statusText = await statusBadge.textContent();
        const isInstalled = statusText?.includes('Installed');

        // Scope count badge assertions to the content panel (inner main) to avoid
        // matching nav links (e.g. "Events" in header/bottom tab bar).
        const contentPanel = page.locator('main').last();

        if (isInstalled) {
            await expect(contentPanel.getByText('Users')).toBeVisible();
            await expect(contentPanel.getByText('Events')).toBeVisible();
            await expect(contentPanel.getByText('Characters')).toBeVisible();
            await expect(contentPanel.getByText('Signups')).toBeVisible();

            // Delete button is visible (but we do NOT click it)
            await expect(
                page.getByRole('button', { name: 'Delete All Demo Data' }),
            ).toBeVisible();
        } else {
            // Install button is visible (but we do NOT click it)
            await expect(
                page.getByRole('button', { name: 'Install Demo Data' }),
            ).toBeVisible();
        }
    });

    test('no error boundary on load', async ({ page }) => {
        await page.goto('/admin/settings/general/data');
        await expect(
            page.getByRole('heading', { name: 'Demo Data', level: 2 }).first(),
        ).toBeVisible({ timeout: 15_000 });

        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Admin sidebar navigation (desktop only — hidden on mobile)
// ---------------------------------------------------------------------------

test.describe('Admin sidebar navigation', () => {
    test('sidebar shows General section links and navigates between panels', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — sidebar hidden on mobile');

        await page.goto('/admin/settings/general');

        const sidebar = page.locator('nav[aria-label="Admin settings navigation"]');
        await expect(sidebar).toBeVisible({ timeout: 15_000 });

        // General section links are present
        await expect(sidebar.getByRole('link', { name: 'Site Settings' })).toBeVisible();
        await expect(sidebar.getByRole('link', { name: 'User Management' })).toBeVisible();
        await expect(sidebar.getByRole('link', { name: 'Demo Data' })).toBeVisible();

        // Navigate to User Management via sidebar
        await sidebar.getByRole('link', { name: 'User Management' }).click();
        await expect(page).toHaveURL(/\/admin\/settings\/general\/roles/);
        await expect(
            page.getByRole('heading', { name: 'User Management', level: 2 }),
        ).toBeVisible({ timeout: 10_000 });

        // Navigate to Demo Data via sidebar
        await sidebar.getByRole('link', { name: 'Demo Data' }).click();
        await expect(page).toHaveURL(/\/admin\/settings\/general\/data/);
        await expect(
            page.getByRole('heading', { name: 'Demo Data', level: 2 }).first(),
        ).toBeVisible({ timeout: 10_000 });

        // Navigate back to Site Settings via sidebar
        await sidebar.getByRole('link', { name: 'Site Settings' }).click();
        await expect(page).toHaveURL(/\/admin\/settings\/general$/);
        await expect(
            page.getByRole('heading', { name: 'Site Settings', level: 2 }),
        ).toBeVisible({ timeout: 10_000 });
    });
});
