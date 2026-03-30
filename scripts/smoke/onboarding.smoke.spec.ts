/**
 * Onboarding wizard smoke tests — wizard rendering, step navigation,
 * games step content, progress indicator, Steam step (ROK-941),
 * and error-free loading.
 *
 * The demo admin user has already completed onboarding, so we use
 * ?rerun=1 to bypass the redirect and re-enter the wizard.
 *
 * IMPORTANT: These tests do NOT complete onboarding or modify guild
 * configuration — they only verify rendering and navigation.
 */
import { test, expect } from '@playwright/test';
import { isMobile } from './helpers';

const WIZARD_URL = '/onboarding?rerun=1';

/**
 * Navigate to the onboarding wizard and wait for the dialog to appear.
 * Returns the dialog locator for chaining.
 */
async function openWizard(page: import('@playwright/test').Page) {
    await page.goto(WIZARD_URL);
    const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    return dialog;
}

// ---------------------------------------------------------------------------
// Wizard rendering
// ---------------------------------------------------------------------------

test.describe('Onboarding wizard', () => {
    test('wizard renders with dialog and step counter', async ({ page }) => {
        const dialog = await openWizard(page);

        // Step counter should show "Step 1 of N"
        await expect(dialog.getByText(/Step 1 of \d+/)).toBeVisible();

        // Skip All button visible on first (non-final) step
        await expect(dialog.getByRole('button', { name: 'Skip All' })).toBeVisible();

        // Next button visible on first step
        await expect(dialog.getByRole('button', { name: 'Next' })).toBeVisible();

        // Back button should NOT be visible on first step
        await expect(dialog.getByRole('button', { name: 'Back' })).not.toBeVisible();
    });

    test('first step is Steam (when configured) or Games (when not)', async ({ page }) => {
        const dialog = await openWizard(page);

        // When Steam is configured AND the admin has no Steam linked,
        // the first step is "Connect Your Steam Account" (ROK-941).
        // When Steam is NOT configured, the first step is Games.
        // Check which is shown — at least one must be visible.
        const steamHeading = dialog.getByRole('heading', { name: 'Connect Your Steam Account' });
        const gamesHeading = dialog.getByRole('heading', { name: 'What Do You Play?' });

        const isSteamStep = await steamHeading.isVisible({ timeout: 10_000 }).catch(() => false);
        if (isSteamStep) {
            // Steam step is first — verify its content
            await expect(steamHeading).toBeVisible();
        } else {
            // Games step is first — original assertion
            await expect(gamesHeading).toBeVisible({ timeout: 10_000 });
            await expect(dialog.getByPlaceholder('Search for a game...')).toBeVisible();
        }
    });

    test('wizard loads without error boundary', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
        });

        await openWizard(page);

        // No React error boundary text
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 5_000 });

        // Filter benign errors (network, favicon, CORS, third-party scripts)
        const critical = errors.filter(
            (e) =>
                !e.includes('net::') &&
                !e.includes('favicon') &&
                !e.includes('404') &&
                !e.includes('429') &&
                !e.includes('CORS') &&
                !e.includes('ERR_CONNECTION_REFUSED') &&
                !e.includes('Failed to load resource') &&
                !e.includes('responsive row') &&
                !e.includes('zamimg'),
        );
        expect(critical).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------

test.describe('Onboarding wizard step navigation', () => {
    test('Next button advances to step 2 and Back returns to step 1', async ({ page }) => {
        const dialog = await openWizard(page);

        // Verify we start on step 1
        await expect(dialog.getByText(/Step 1 of \d+/)).toBeVisible();

        // Click Next to advance
        await dialog.getByRole('button', { name: 'Next' }).click();

        // Should now show step 2
        await expect(dialog.getByText(/Step 2 of \d+/)).toBeVisible({ timeout: 5_000 });

        // Back button should now be visible
        const backBtn = dialog.getByRole('button', { name: 'Back' });
        await expect(backBtn).toBeVisible();

        // Click Back to return to step 1
        await backBtn.click();
        await expect(dialog.getByText(/Step 1 of \d+/)).toBeVisible({ timeout: 5_000 });
    });

    test('Skip button advances to next step', async ({ page }) => {
        const dialog = await openWizard(page);

        // Skip button should be visible on non-final steps (use exact to avoid matching "Skip All")
        const skipBtn = dialog.getByRole('button', { name: 'Skip', exact: true });
        await expect(skipBtn).toBeVisible();

        // Click Skip to advance
        await skipBtn.click();
        await expect(dialog.getByText(/Step 2 of \d+/)).toBeVisible({ timeout: 5_000 });
    });

    test('progress breadcrumbs show current step', async ({ page }) => {
        const dialog = await openWizard(page);

        // The breadcrumb bar should contain step labels.
        // The "Games" label should be visible as it is the current/adjacent step.
        await expect(dialog.getByRole('button', { name: 'Games' })).toBeVisible({ timeout: 5_000 });

        // Advance to step 2 and verify breadcrumbs update
        await dialog.getByRole('button', { name: 'Next' }).click();
        await expect(dialog.getByText(/Step 2 of \d+/)).toBeVisible({ timeout: 5_000 });

        // The "Game Time" label should be visible in breadcrumbs
        // (it is the current or adjacent step after advancing from Games)
        await expect(dialog.getByText('Game Time')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Games step content
// ---------------------------------------------------------------------------

test.describe('Onboarding wizard games step', () => {
    test('genre filter chips are visible', async ({ page }) => {
        const dialog = await openWizard(page);

        // Wait for games step header
        await expect(dialog.getByRole('heading', { name: 'What Do You Play?' })).toBeVisible({ timeout: 10_000 });

        // Genre chips: All is always present, plus specific genres
        await expect(dialog.getByRole('button', { name: 'All', exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'RPG', exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'MMORPG', exact: true })).toBeVisible();
    });

    test('game search input accepts text', async ({ page }) => {
        const dialog = await openWizard(page);

        const searchInput = dialog.getByPlaceholder('Search for a game...');
        await expect(searchInput).toBeVisible({ timeout: 10_000 });

        // Type into the search input
        await searchInput.fill('World');
        await expect(searchInput).toHaveValue('World');
    });
});

// ---------------------------------------------------------------------------
// Steam step (ROK-941)
// ---------------------------------------------------------------------------

const API_BASE = process.env.API_URL || 'http://localhost:3000';

/**
 * Check whether the server has Steam configured via the system status API.
 * Returns true when steamConfigured=true in the /system/status response.
 */
async function isSteamConfigured(): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE}/system/status`);
        if (!res.ok) return false;
        const data = (await res.json()) as { steamConfigured?: boolean };
        return !!data.steamConfigured;
    } catch {
        return false;
    }
}

test.describe('Onboarding wizard Steam step (ROK-941)', () => {
    test('Steam step appears when steamConfigured=true and user has no Steam linked', async ({ page }) => {
        const steamEnabled = await isSteamConfigured();
        test.skip(!steamEnabled, 'Steam not configured in this environment — step is conditionally hidden');

        const dialog = await openWizard(page);

        // The Steam step should be the first step (after Discord Connect, which
        // the admin user skips because Discord is already linked).
        // It should show the "Connect Your Steam Account" heading.
        await expect(
            dialog.getByRole('heading', { name: 'Connect Your Steam Account' }),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('Steam step shows value prop text and Connect Steam button', async ({ page }) => {
        const steamEnabled = await isSteamConfigured();
        test.skip(!steamEnabled, 'Steam not configured in this environment — step is conditionally hidden');

        const dialog = await openWizard(page);

        // Wait for Steam step to appear
        await expect(
            dialog.getByRole('heading', { name: 'Connect Your Steam Account' }),
        ).toBeVisible({ timeout: 10_000 });

        // Value prop text should be visible
        await expect(dialog.getByText(/steam/i)).toBeVisible();

        // "Connect Steam" button should be visible
        await expect(
            dialog.getByRole('button', { name: /Connect Steam/i }),
        ).toBeVisible();
    });

    test('Steam step Connect Steam button links to correct auth URL', async ({ page }) => {
        const steamEnabled = await isSteamConfigured();
        test.skip(!steamEnabled, 'Steam not configured in this environment — step is conditionally hidden');

        const dialog = await openWizard(page);

        await expect(
            dialog.getByRole('heading', { name: 'Connect Your Steam Account' }),
        ).toBeVisible({ timeout: 10_000 });

        // The "Connect Steam" button (or link) should target the Steam auth endpoint
        // with returnTo=/onboarding
        const connectBtn = dialog.getByRole('button', { name: /Connect Steam/i });
        await expect(connectBtn).toBeVisible();

        // Verify the link/button href includes the steam link endpoint with returnTo
        const linkOrBtn = dialog.locator('a[href*="/auth/steam/link"]');
        await expect(linkOrBtn).toBeVisible({ timeout: 5_000 });
        const href = await linkOrBtn.getAttribute('href');
        expect(href).toContain('returnTo=');
        expect(href).toContain('%2Fonboarding');
    });

    test('Skip button on Steam step advances to Games step', async ({ page }) => {
        const steamEnabled = await isSteamConfigured();
        test.skip(!steamEnabled, 'Steam not configured in this environment — step is conditionally hidden');

        const dialog = await openWizard(page);

        // Verify Steam step is showing
        await expect(
            dialog.getByRole('heading', { name: 'Connect Your Steam Account' }),
        ).toBeVisible({ timeout: 10_000 });

        // Click Skip to advance past the Steam step
        const skipBtn = dialog.getByRole('button', { name: 'Skip', exact: true });
        await expect(skipBtn).toBeVisible();
        await skipBtn.click();

        // After skipping Steam, the next step should be Games
        await expect(
            dialog.getByRole('heading', { name: 'What Do You Play?' }),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('Steam step appears before Games in breadcrumb order', async ({ page }) => {
        const steamEnabled = await isSteamConfigured();
        test.skip(!steamEnabled, 'Steam not configured in this environment — step is conditionally hidden');

        const dialog = await openWizard(page);

        // The breadcrumb bar should show Steam before Games
        await expect(dialog.getByRole('button', { name: 'Steam' })).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByRole('button', { name: 'Games' })).toBeVisible({ timeout: 5_000 });

        // Verify Steam step is currently active (step 1)
        await expect(dialog.getByText(/Step 1 of \d+/)).toBeVisible();
        await expect(
            dialog.getByRole('heading', { name: 'Connect Your Steam Account' }),
        ).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Final step
// ---------------------------------------------------------------------------

test.describe('Onboarding wizard final step', () => {
    test('final step shows Complete button instead of Next', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — breadcrumb tap navigation may differ on mobile');

        const dialog = await openWizard(page);

        // Navigate to the final step by clicking Next/Skip until Complete appears
        // AND Skip All is hidden (both conditions confirm we're truly on the last step).
        // Step count is dynamic — character steps load async, so Complete may appear
        // momentarily on a non-final step before a new step is appended.
        const maxClicks = 10; // safety limit
        for (let i = 0; i < maxClicks; i++) {
            const complete = dialog.getByRole('button', { name: 'Complete' });
            const skipAll = dialog.getByRole('button', { name: 'Skip All' });
            const isComplete = await complete.isVisible({ timeout: 1_000 }).catch(() => false);
            const isSkipAllGone = !(await skipAll.isVisible({ timeout: 500 }).catch(() => false));
            if (isComplete && isSkipAllGone) break;
            const nextBtn = dialog.getByRole('button', { name: 'Next' });
            const skipBtn = dialog.getByRole('button', { name: 'Skip', exact: true });
            const hasNext = await nextBtn.isVisible({ timeout: 1_000 }).catch(() => false);
            if (hasNext) {
                await nextBtn.click();
            } else {
                const hasSkip = await skipBtn.isVisible({ timeout: 1_000 }).catch(() => false);
                if (!hasSkip) break;
                await skipBtn.click();
            }
        }

        // On final step: Complete button should be visible, Next and Skip All should not
        await expect(dialog.getByRole('button', { name: 'Complete' })).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByRole('button', { name: 'Next' })).not.toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Skip All' })).not.toBeVisible();
    });
});
