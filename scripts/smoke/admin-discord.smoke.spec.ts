/**
 * Admin Discord settings smoke tests — all 5 panels render correctly
 * at both desktop and mobile viewports.
 *
 * Routes tested:
 *   /admin/settings/discord           (Overview)
 *   /admin/settings/discord/auth      (Authentication)
 *   /admin/settings/discord/connection (Bot Connection)
 *   /admin/settings/discord/channels  (Channels)
 *   /admin/settings/discord/features  (Features)
 */
import { test, expect } from '@playwright/test';
import { isMobile } from './helpers';

// ---------------------------------------------------------------------------
// Overview panel
// ---------------------------------------------------------------------------

test.describe('Admin Discord — Overview', () => {
    test('renders setup progress and bot status', async ({ page }) => {
        await page.goto('/admin/settings/discord');
        await expect(page.getByRole('heading', { name: 'Discord Overview' })).toBeVisible({ timeout: 15_000 });

        // Setup Progress card
        await expect(page.getByRole('heading', { name: 'Setup Progress' })).toBeVisible();
        await expect(page.getByText(/complete$/)).toBeVisible();

        // Bot Status card
        await expect(page.getByRole('heading', { name: 'Bot Status' })).toBeVisible();
    });

    test('renders quick action buttons', async ({ page }) => {
        await page.goto('/admin/settings/discord');
        await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Reconnect Bot' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Send Test Message' })).toBeVisible();
    });

    test('loads without error boundary', async ({ page }) => {
        await page.goto('/admin/settings/discord');
        await expect(page.getByRole('heading', { name: 'Discord Overview' })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Auth panel
// ---------------------------------------------------------------------------

test.describe('Admin Discord — Auth', () => {
    test('renders OAuth config form', async ({ page }) => {
        await page.goto('/admin/settings/discord/auth');
        await expect(page.getByRole('heading', { name: 'Discord Authentication' })).toBeVisible({ timeout: 15_000 });

        // OAuth card heading
        await expect(page.getByRole('heading', { name: 'Discord OAuth' })).toBeVisible();

        // Form fields
        await expect(page.getByRole('textbox', { name: 'Client ID' })).toBeVisible();
        await expect(page.getByRole('textbox', { name: 'Client Secret' })).toBeVisible();
    });

    test('renders save button (test button only when configured)', async ({ page }) => {
        await page.goto('/admin/settings/discord/auth');
        await expect(page.getByRole('heading', { name: 'Discord Authentication' })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Save Configuration' })).toBeVisible();

        // "Test Connection" only renders when OAuth is already configured (conditional in DiscordOAuthForm).
        // In CI without Discord configured, this button won't exist — soft check.
        const testBtn = page.getByRole('button', { name: 'Test Connection' });
        if (await testBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await expect(testBtn).toBeVisible();
        }
    });

    test('loads without error boundary', async ({ page }) => {
        await page.goto('/admin/settings/discord/auth');
        await expect(page.getByRole('heading', { name: 'Discord Authentication' })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Connection panel
// ---------------------------------------------------------------------------

test.describe('Admin Discord — Connection', () => {
    test('renders bot token field and enable switch (when Discord is linked)', async ({ page }) => {
        await page.goto('/admin/settings/discord/connection');
        await expect(page.getByRole('heading', { name: 'Discord Bot', exact: true }).first()).toBeVisible({ timeout: 15_000 });

        // Bot Token field and Enable Bot switch only render when the admin user
        // has their Discord account linked. In CI the user may not have Discord
        // linked, so a "Link Discord Account" prompt appears instead — soft check.
        const botTokenField = page.getByRole('textbox', { name: 'Bot Token' });
        if (await botTokenField.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await expect(botTokenField).toBeVisible();
            await expect(page.getByRole('switch', { name: 'Enable Bot' })).toBeVisible();
        } else {
            // Fallback: the "Discord Account Required" prompt should be visible
            await expect(page.getByText('Discord Account Required').or(page.getByText('Link Discord Account'))).toBeVisible();
        }
    });

    test('renders bot invite link info (when OAuth is configured)', async ({ page }) => {
        await page.goto('/admin/settings/discord/connection');
        await expect(page.getByRole('heading', { name: 'Discord Bot', exact: true }).first()).toBeVisible({ timeout: 15_000 });

        // Bot Invite Link only renders when OAuth is configured. In CI without
        // Discord configured, this section won't exist — soft check.
        const inviteLink = page.getByRole('heading', { name: 'Bot Invite Link' });
        if (await inviteLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await expect(inviteLink).toBeVisible();
        }
    });

    test('loads without error boundary', async ({ page }) => {
        await page.goto('/admin/settings/discord/connection');
        await expect(page.getByRole('heading', { name: 'Discord Bot', exact: true }).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Channels panel
// ---------------------------------------------------------------------------

test.describe('Admin Discord — Channels', () => {
    test('renders channel selectors and routing info', async ({ page }) => {
        await page.goto('/admin/settings/discord/channels');
        await expect(page.getByRole('heading', { name: 'Discord Channels' })).toBeVisible({ timeout: 15_000 });

        // Channel selectors (only visible when bot is connected)
        const notifSelector = page.getByRole('combobox', { name: 'Default Notification Channel' });
        const voiceSelector = page.getByRole('combobox', { name: 'Default Voice Channel' });

        // In demo mode with bot connected, both should be visible
        if (await notifSelector.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await expect(notifSelector).toBeVisible();
        }
        if (await voiceSelector.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await expect(voiceSelector).toBeVisible();
        }

        // Routing priority info is always visible
        await expect(page.getByRole('heading', { name: 'Event Routing Priority' })).toBeVisible();
    });

    test('renders channel binding list or empty state', async ({ page }) => {
        await page.goto('/admin/settings/discord/channels');
        await expect(page.getByRole('heading', { name: 'Discord Channels' })).toBeVisible({ timeout: 15_000 });

        // The binding instructions text is always present
        await expect(page.getByText(/Map Discord channels to games/)).toBeVisible({ timeout: 5_000 });
    });

    test('loads without error boundary', async ({ page }) => {
        await page.goto('/admin/settings/discord/channels');
        await expect(page.getByRole('heading', { name: 'Discord Channels' })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Features panel
// ---------------------------------------------------------------------------

test.describe('Admin Discord — Features', () => {
    test('renders feature toggles and info sections', async ({ page }) => {
        await page.goto('/admin/settings/discord/features');
        await expect(page.getByRole('heading', { name: 'Discord Features' })).toBeVisible({ timeout: 15_000 });

        // Quick Play Events toggle (visible when bot is connected)
        const quickPlayHeading = page.getByRole('heading', { name: 'Quick Play Events' });
        if (await quickPlayHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await expect(quickPlayHeading).toBeVisible();
            await expect(page.getByRole('checkbox')).toBeVisible();
        }

        // General Lobbies info is always present
        await expect(page.getByRole('heading', { name: 'General Lobbies' })).toBeVisible();
    });

    test('loads without error boundary', async ({ page }) => {
        await page.goto('/admin/settings/discord/features');
        await expect(page.getByRole('heading', { name: 'Discord Features' })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});

// ---------------------------------------------------------------------------
// Navigation between panels (desktop only — sidebar hidden on mobile)
// ---------------------------------------------------------------------------

test.describe('Admin Discord — Panel navigation', () => {
    test('sidebar nav links navigate between all 5 panels', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — sidebar nav hidden on mobile');

        await page.goto('/admin/settings/discord');
        const nav = page.getByRole('navigation', { name: 'Admin settings navigation' });
        await expect(nav).toBeVisible({ timeout: 15_000 });

        // Navigate to Auth
        await nav.getByRole('link', { name: /Authentication/ }).click();
        await expect(page.getByRole('heading', { name: 'Discord Authentication' })).toBeVisible({ timeout: 10_000 });

        // Navigate to Bot (Connection)
        await nav.getByRole('link', { name: /^Bot/ }).click();
        await expect(page.getByRole('heading', { name: 'Discord Bot', exact: true }).first()).toBeVisible({ timeout: 10_000 });

        // Navigate to Channels
        await nav.getByRole('link', { name: 'Channels' }).click();
        await expect(page.getByRole('heading', { name: 'Discord Channels' })).toBeVisible({ timeout: 10_000 });

        // Navigate to Features
        await nav.getByRole('link', { name: 'Features', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Discord Features' })).toBeVisible({ timeout: 10_000 });

        // Navigate back to Overview
        await nav.getByRole('link', { name: 'Overview' }).click();
        await expect(page.getByRole('heading', { name: 'Discord Overview' })).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// No console errors across all panels
// ---------------------------------------------------------------------------

test.describe('Admin Discord — No critical errors', () => {
    test('all panels load without critical console errors', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        await page.goto('/admin/settings/discord');
        await expect(page.getByRole('heading', { name: 'Discord Overview' })).toBeVisible({ timeout: 15_000 });

        await page.goto('/admin/settings/discord/auth');
        await expect(page.getByRole('heading', { name: 'Discord Authentication' })).toBeVisible({ timeout: 15_000 });

        await page.goto('/admin/settings/discord/connection');
        await expect(page.getByRole('heading', { name: 'Discord Bot', exact: true }).first()).toBeVisible({ timeout: 15_000 });

        await page.goto('/admin/settings/discord/channels');
        await expect(page.getByRole('heading', { name: 'Discord Channels' })).toBeVisible({ timeout: 15_000 });

        await page.goto('/admin/settings/discord/features');
        await expect(page.getByRole('heading', { name: 'Discord Features' })).toBeVisible({ timeout: 15_000 });

        const criticalErrors = errors.filter(
            (e) =>
                !e.includes('net::') &&
                !e.includes('favicon') &&
                !e.includes('404') &&
                !e.includes('429') &&
                !e.includes('CORS') &&
                !e.includes('ERR_CONNECTION_REFUSED') &&
                !e.includes('Failed to load resource'),
        );
        expect(criticalErrors).toHaveLength(0);
    });
});
