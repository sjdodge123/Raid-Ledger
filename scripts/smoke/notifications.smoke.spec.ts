/**
 * Notifications smoke tests — bell icon, dropdown, mark all read.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';

// ROK-1070 Codex review (P2): removed the file-level reset-to-seed
// beforeAll. Playwright runs the desktop and mobile projects in parallel
// against the same DB, and reset-to-seed truncates global tables. A
// per-file reset wipes fixtures the OTHER project just created in its own
// beforeAll. Global setup (scripts/playwright-global-setup.ts) already
// runs reset-to-seed once at the start of the suite — that is sufficient
// for this single-test file to see clean baseline data.

/**
 * Locate the notification bell, wait for it to be visible AND enabled, then
 * open the dropdown and confirm the "Notifications" heading rendered. The bell
 * is uniquely identified by its `aria-label="Notifications"` accessible name
 * (NotificationBell.tsx) — no extra test affordance is required.
 *
 * ROK-1286: the bell is a React-state toggle (`setIsOpen`). Under full-suite
 * latency the button can paint before the page has hydrated, so a click fired
 * the instant it becomes visible is a no-op and the heading never appears.
 * Gating on visible+enabled and retrying the open once (re-clicking when the
 * heading hasn't materialised) makes the open deterministic without weakening
 * the assertion that the dropdown actually opens.
 */
async function openNotificationDropdown(page: Page): Promise<void> {
    const bellBtn = page.getByRole('button', { name: 'Notifications' }).first();
    await expect(bellBtn).toBeVisible({ timeout: 15_000 });
    await expect(bellBtn).toBeEnabled({ timeout: 15_000 });

    const heading = page.getByRole('heading', { name: 'Notifications' });
    await bellBtn.click();
    if (await heading.isVisible({ timeout: 5_000 }).catch(() => false)) return;
    // Hydration race: the first click landed before React wired the handler.
    // Re-click and wait on the heading with the full budget.
    await bellBtn.click();
    await expect(heading).toBeVisible({ timeout: 15_000 });
}

test.describe('Notifications', () => {
    test('bell icon is visible in header', async ({ page }) => {
        await page.goto('/calendar');
        await expect(
            page.getByRole('button', { name: 'Notifications' }).first(),
        ).toBeVisible({ timeout: 15_000 });
    });

    test('dropdown opens and shows content', async ({ page }) => {
        await page.goto('/calendar');
        await openNotificationDropdown(page);

        // Should show either notification items or the empty state
        const notificationItems = page.locator('.divide-y > *');
        const emptyState = page.getByText('No notifications');
        await expect(notificationItems.first().or(emptyState)).toBeVisible({ timeout: 5_000 });
    });

    test('Mark All Read button works', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — notification dropdown differs on mobile');

        await page.goto('/calendar');
        await openNotificationDropdown(page);

        const markAllReadBtn = page.getByRole('button', { name: 'Mark All Read' });
        if (await markAllReadBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await markAllReadBtn.click();
            // After marking all as read, verify no errors
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });
});
