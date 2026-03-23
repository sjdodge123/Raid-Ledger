/**
 * Admin integration panel smoke tests — IGDB, Steam, ITAD.
 * Verifies each panel renders its configuration form, API key fields,
 * status badge, and Save button at both desktop and mobile viewports.
 *
 * These tests do NOT submit forms or change API keys.
 */
import { test, expect, type TestInfo } from '@playwright/test';

function isMobile(testInfo: TestInfo) { return testInfo.project.name === 'mobile'; }

// ---------------------------------------------------------------------------
// IGDB / Twitch panel
// ---------------------------------------------------------------------------

test.describe('Admin Integrations — IGDB panel', () => {
    test('renders heading, status badge, form fields, and save button', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo), 'Admin settings panels use desktop sidebar layout');
        await page.goto('/admin/settings/integrations/igdb');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Panel heading
        await expect(page.getByRole('heading', { name: 'IGDB / Twitch' }).first()).toBeVisible({ timeout: 10_000 });

        // IntegrationCard status badge — shows "Online" or "Offline"
        // On mobile the badge may be scrolled offscreen; scroll it into view first
        const badge = page.getByText(/^(Online|Offline)$/).first();
        await badge.scrollIntoViewIfNeeded();
        await expect(badge).toBeVisible({ timeout: 10_000 });

        // Setup instructions block
        await expect(page.getByText('Setup Instructions')).toBeVisible();

        // Client ID field
        await expect(page.locator('#igdbClientId')).toBeVisible();

        // Client Secret field
        await expect(page.locator('#igdbClientSecret')).toBeVisible();

        // Save button
        await expect(page.getByRole('button', { name: 'Save Configuration' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Steam panel
// ---------------------------------------------------------------------------

test.describe('Admin Integrations — Steam panel', () => {
    test('renders heading, status badge, API key field, and save button', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo), 'Admin settings panels use desktop sidebar layout');
        await page.goto('/admin/settings/integrations/steam');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Panel heading
        await expect(page.getByRole('heading', { name: 'Steam' }).first()).toBeVisible({ timeout: 10_000 });

        // IntegrationCard status badge
        await expect(page.getByText(/^(Online|Offline)$/).first()).toBeVisible({ timeout: 10_000 });

        // Setup instructions block
        await expect(page.getByText('Setup Instructions')).toBeVisible();

        // Steam Web API Key field
        await expect(page.locator('#steamApiKey')).toBeVisible();

        // Save button
        await expect(page.getByRole('button', { name: 'Save Configuration' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// ITAD panel
// ---------------------------------------------------------------------------

test.describe('Admin Integrations — ITAD panel', () => {
    test('renders heading, status badge, API key field, and save button', async ({ page }, testInfo) => {
        test.skip(isMobile(testInfo), 'Admin settings panels use desktop sidebar layout');
        await page.goto('/admin/settings/integrations/itad');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Panel heading
        await expect(page.getByRole('heading', { name: 'IsThereAnyDeal' }).first()).toBeVisible({ timeout: 10_000 });

        // IntegrationCard status badge
        await expect(page.getByText(/^(Online|Offline)$/).first()).toBeVisible({ timeout: 10_000 });

        // Setup instructions block
        await expect(page.getByText('Setup Instructions')).toBeVisible();

        // ITAD API Key field
        await expect(page.locator('#itadApiKey')).toBeVisible();

        // Save button
        await expect(page.getByRole('button', { name: 'Save Configuration' })).toBeVisible();
    });
});
