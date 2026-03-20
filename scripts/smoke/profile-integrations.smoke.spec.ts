/**
 * Profile integrations and notifications panel smoke tests (ROK-900).
 *
 * Verifies that the /profile/integrations and /profile/notifications panels
 * render correctly at both desktop and mobile viewports. Does NOT modify any
 * user preferences — read-only UI assertions only.
 */
import { test, expect } from '@playwright/test';
import { isMobile } from './helpers';

// ---------------------------------------------------------------------------
// Integrations panel — /profile/integrations
// ---------------------------------------------------------------------------

test.describe('Profile integrations panel', () => {
    test('renders integrations heading and description', async ({ page }) => {
        await page.goto('/profile/integrations');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Manage your linked accounts and external services.')).toBeVisible({ timeout: 5_000 });
    });

    test('shows Discord connection status or link prompt', async ({ page }) => {
        await page.goto('/profile/integrations');
        await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible({ timeout: 10_000 });

        // In demo mode the user may have Discord linked ("Discord linked") or see
        // a CTA to connect. Either state is valid — verify one is present.
        const linkedText = page.getByText('Discord linked');
        const linkCta = page.getByText(/link.*discord/i);
        await expect(linkedText.or(linkCta)).toBeVisible({ timeout: 5_000 });
    });

    test('profile sidebar shows Integrations section on desktop', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo), 'Desktop-only test — sidebar hidden on mobile');

        await page.goto('/profile/integrations');
        const sidebar = page.locator('nav[aria-label="Profile navigation"]');
        await expect(sidebar).toBeVisible({ timeout: 10_000 });

        await expect(sidebar.getByText('Integrations')).toBeVisible({ timeout: 5_000 });
        await expect(sidebar.getByRole('link', { name: 'My Integrations' })).toBeVisible({ timeout: 5_000 });
    });

    test('loads without error boundary on mobile', async ({ page }, testInfo) => {
        test.skip(!isMobile(testInfo), 'Mobile-only test');

        await page.goto('/profile/integrations');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Mobile shows "My Settings" heading and hides sidebar
        await expect(page.getByRole('heading', { name: 'My Settings' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Notifications panel — /profile/notifications
// ---------------------------------------------------------------------------

test.describe('Profile notifications panel', () => {
    test('renders notification preferences heading and description', async ({ page }) => {
        await page.goto('/profile/notifications');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Choose how and when you get notified')).toBeVisible({ timeout: 5_000 });
    });

    test('shows notification type rows with toggle buttons', async ({ page }) => {
        await page.goto('/profile/notifications');
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 10_000 });

        // Verify several notification types are rendered as rows
        await expect(page.getByText('Slot Vacated')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('Event Reminders')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('New Events')).toBeVisible({ timeout: 5_000 });

        // Verify channel toggle buttons exist — each row has per-channel toggles.
        // The In-App column header should always be present.
        await expect(page.getByText('In-App')).toBeVisible({ timeout: 5_000 });

        // At least one toggle button should be present (e.g., "Enable/Disable Slot Vacated inApp notifications")
        const toggleButtons = page.locator('button[aria-label*="notifications"]');
        await expect(toggleButtons.first()).toBeVisible({ timeout: 5_000 });
    });

    test('toggle buttons are interactive but test does not change preferences', async ({ page }) => {
        await page.goto('/profile/notifications');
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 10_000 });

        // Verify toggles are not disabled — they should be clickable buttons
        const firstToggle = page.locator('button[aria-label*="notifications"]').first();
        await expect(firstToggle).toBeVisible({ timeout: 5_000 });
        await expect(firstToggle).toBeEnabled();
    });

    test('loads without error boundary on mobile', async ({ page }, testInfo) => {
        test.skip(!isMobile(testInfo), 'Mobile-only test');

        await page.goto('/profile/notifications');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        await expect(page.getByRole('heading', { name: 'My Settings' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Cross-panel navigation
// ---------------------------------------------------------------------------

test.describe('Profile panel navigation', () => {
    test('navigates between integrations and notifications via sidebar links', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo), 'Desktop-only test — sidebar hidden on mobile');

        await page.goto('/profile/integrations');
        const sidebar = page.locator('nav[aria-label="Profile navigation"]');
        await expect(sidebar).toBeVisible({ timeout: 10_000 });

        // Navigate to Notifications via sidebar
        await sidebar.getByRole('link', { name: 'Notifications' }).click();
        await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Choose how and when you get notified')).toBeVisible({ timeout: 5_000 });

        // Navigate back to Integrations via sidebar
        await sidebar.getByRole('link', { name: 'My Integrations' }).click();
        await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText('Manage your linked accounts and external services.')).toBeVisible({ timeout: 5_000 });
    });
});
