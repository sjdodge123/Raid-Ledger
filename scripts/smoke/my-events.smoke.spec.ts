/**
 * My Events / Event Metrics dashboard smoke tests — page load, stats,
 * dashboard tab, analytics tab at desktop and mobile viewports.
 */
import { test, expect } from './base';

// ---------------------------------------------------------------------------
// Dashboard Tab (default view)
// ---------------------------------------------------------------------------

test.describe('My Events dashboard', () => {
    test('page renders heading and stats content', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Stats row renders four stat cards with known labels.
        // The stat labels are <p> text inside stat card divs.
        await expect(page.getByText('Upcoming', { exact: true })).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.getByText('Signups', { exact: true })).toBeVisible();
        await expect(page.getByText('Avg Fill', { exact: true })).toBeVisible();
        await expect(
            page.getByText('Needs Attention', { exact: true }),
        ).toBeVisible();
    });

    test('event cards grid and activity feed are visible', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Admin sees "All Upcoming Events"; non-admin sees "Your Events".
        // Demo user is admin, so assert admin heading.
        await expect(
            page.getByRole('heading', { name: 'All Upcoming Events' }),
        ).toBeVisible({ timeout: 10_000 });

        // Recent Activity section
        await expect(
            page.getByRole('heading', { name: 'Recent Activity' }),
        ).toBeVisible();
    });

    test('tab switcher shows Dashboard and Analytics tabs', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Admin user sees tab switcher with Dashboard and Analytics buttons
        const dashboardTab = page.getByRole('button', { name: 'Dashboard' });
        const analyticsTab = page.getByRole('button', { name: 'Analytics' });

        await expect(dashboardTab).toBeVisible({ timeout: 10_000 });
        await expect(analyticsTab).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Analytics Tab
// ---------------------------------------------------------------------------

test.describe('My Events analytics tab', () => {
    test('clicking Analytics tab shows analytics sections', async ({ page }) => {
        await page.goto('/event-metrics');
        await expect(
            page.getByRole('heading', { name: 'Event Metrics' }),
        ).toBeVisible({ timeout: 15_000 });

        // Switch to Analytics tab
        await page.getByRole('button', { name: 'Analytics' }).click();

        // Verify all four analytics sections render their headings
        await expect(
            page.getByRole('heading', { name: 'Attendance Trends' }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(
            page.getByRole('heading', { name: 'Reliability Leaderboard' }),
        ).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Per-Game Breakdown' }),
        ).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'No-Show Patterns' }),
        ).toBeVisible();

        // Attendance Trends has period toggle buttons
        await expect(
            page.getByRole('button', { name: '30 Days' }),
        ).toBeVisible();
        await expect(
            page.getByRole('button', { name: '90 Days' }),
        ).toBeVisible();
    });
});
