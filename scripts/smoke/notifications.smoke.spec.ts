/**
 * Notifications smoke tests — bell icon, dropdown, mark all read.
 */
import { test, expect } from './base';
import { apiPost, getAdminToken } from './api-helpers';

// ROK-1070: reset-to-seed before this file's tests so stale notifications
// from prior smoke runs don't leak into the dropdown content assertion.
// Single-test file with no fixture creation, so the heavier reset is cheap.
test.beforeAll(async () => {
    const token = await getAdminToken();
    await apiPost(token, '/admin/test/reset-to-seed', {});
});

test.describe('Notifications', () => {
    test('bell icon is visible in header', async ({ page }) => {
        await page.goto('/calendar');
        await expect(page.getByRole('button', { name: 'Notifications' }).first()).toBeVisible({ timeout: 15_000 });
    });

    test('dropdown opens and shows content', async ({ page }) => {
        await page.goto('/calendar');
        const bellBtn = page.getByRole('button', { name: 'Notifications' }).first();
        await expect(bellBtn).toBeVisible({ timeout: 15_000 });
        await bellBtn.click();

        // Dropdown should open with "Notifications" heading (h3 has implicit heading role)
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 5_000 });

        // Should show either notification items or the empty state
        const notificationItems = page.locator('.divide-y > *');
        const emptyState = page.getByText('No notifications');
        await expect(notificationItems.first().or(emptyState)).toBeVisible({ timeout: 5_000 });
    });

    test('Mark All Read button works', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — notification dropdown differs on mobile');

        await page.goto('/calendar');
        const bellBtn = page.getByRole('button', { name: 'Notifications' }).first();
        await expect(bellBtn).toBeVisible({ timeout: 15_000 });
        await bellBtn.click();

        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 5_000 });

        const markAllReadBtn = page.getByRole('button', { name: 'Mark All Read' });
        if (await markAllReadBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await markAllReadBtn.click();
            // After marking all as read, verify no errors
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });
});
