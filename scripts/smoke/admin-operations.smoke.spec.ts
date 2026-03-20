/**
 * Admin operations panel smoke tests — cron jobs, backups, logs.
 * Verifies panels render correctly at desktop and mobile viewports.
 * Read-only checks only — no destructive actions (pause/resume/delete).
 */
import { test, expect } from '@playwright/test';
import { isMobile } from './helpers';

// ---------------------------------------------------------------------------
// Cron Jobs Panel
// ---------------------------------------------------------------------------

test.describe('Admin — Cron Jobs panel', () => {
    test('renders job list with heading and job cards (desktop)', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — sidebar navigation not visible on mobile');

        await page.goto('/admin/settings/general/cron-jobs');

        await expect(page.getByRole('heading', { name: 'Scheduled Jobs' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Monitor and manage all scheduled jobs')).toBeVisible();

        // At least one job card should be visible (demo data always has registered jobs)
        const jobHeadings = page.locator('h3');
        await expect(jobHeadings.first()).toBeVisible({ timeout: 10_000 });
        const jobCount = await jobHeadings.count();
        expect(jobCount).toBeGreaterThan(0);

        // Filter buttons should be rendered — "All" pill is always present
        await expect(page.getByRole('button', { name: /^All \(\d+\)$/ })).toBeVisible();

        // No error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('renders job list with heading and job cards (mobile)', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — verifies panel renders without sidebar');

        await page.goto('/admin/settings/general/cron-jobs');

        await expect(page.getByRole('heading', { name: 'Scheduled Jobs' })).toBeVisible({ timeout: 15_000 });

        // Job cards should still render on mobile
        const jobHeadings = page.locator('h3');
        await expect(jobHeadings.first()).toBeVisible({ timeout: 10_000 });
        const jobCount = await jobHeadings.count();
        expect(jobCount).toBeGreaterThan(0);

        // No error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Backups Panel
// ---------------------------------------------------------------------------

test.describe('Admin — Backups panel', () => {
    test('renders backup heading and content (desktop)', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — sidebar navigation not visible on mobile');

        await page.goto('/admin/settings/general/backups');

        await expect(page.getByRole('heading', { name: 'Backups' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Manage database backups')).toBeVisible();

        // "Create Backup" button should be visible
        await expect(page.getByRole('button', { name: 'Create Backup' })).toBeVisible();

        // Should show either backup table rows or empty state message
        const backupTable = page.locator('table');
        const emptyState = page.getByText('No backup files found');
        await expect(backupTable.or(emptyState)).toBeVisible({ timeout: 10_000 });

        // Danger Zone section should be present
        await expect(page.getByRole('heading', { name: 'Danger Zone' })).toBeVisible();

        // No error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('renders backup heading and content (mobile)', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — verifies panel renders without sidebar');

        await page.goto('/admin/settings/general/backups');

        await expect(page.getByRole('heading', { name: 'Backups' })).toBeVisible({ timeout: 15_000 });

        // "Create Backup" button should be visible on mobile
        await expect(page.getByRole('button', { name: 'Create Backup' })).toBeVisible();

        // Should show backup table or empty state
        const backupTable = page.locator('table');
        const emptyState = page.getByText('No backup files found');
        await expect(backupTable.or(emptyState)).toBeVisible({ timeout: 10_000 });

        // No error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Logs Panel
// ---------------------------------------------------------------------------

test.describe('Admin — Logs panel', () => {
    test('renders log viewer heading and content (desktop)', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — sidebar navigation not visible on mobile');

        await page.goto('/admin/settings/general/logs');

        await expect(page.getByRole('heading', { name: 'Container Logs' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Browse and export persistent log files')).toBeVisible();

        // Export button should be visible
        await expect(page.getByRole('button', { name: /Export/ })).toBeVisible();

        // Should show log table or empty state
        const logTable = page.locator('table');
        const emptyState = page.getByText('No log files found');
        await expect(logTable.or(emptyState)).toBeVisible({ timeout: 10_000 });

        // No error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('renders log viewer heading and content (mobile)', async ({ page }) => {
        test.skip(!isMobile(test.info()), 'Mobile-only — verifies panel renders without sidebar');

        await page.goto('/admin/settings/general/logs');

        await expect(page.getByRole('heading', { name: 'Container Logs' })).toBeVisible({ timeout: 15_000 });

        // Export button should be visible on mobile
        await expect(page.getByRole('button', { name: /Export/ })).toBeVisible();

        // Should show log table or empty state
        const logTable = page.locator('table');
        const emptyState = page.getByText('No log files found');
        await expect(logTable.or(emptyState)).toBeVisible({ timeout: 10_000 });

        // No error boundary
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});
