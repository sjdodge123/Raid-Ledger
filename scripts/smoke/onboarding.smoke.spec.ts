/**
 * Onboarding wizard smoke tests — wizard rendering, step navigation,
 * games step content, progress indicator, and error-free loading.
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

    test('first step shows games content', async ({ page }) => {
        const dialog = await openWizard(page);

        // The first step for the admin user (Discord already linked) is Games
        await expect(dialog.getByRole('heading', { name: 'What Do You Play?' })).toBeVisible({ timeout: 10_000 });

        // Search input for games should be visible
        await expect(dialog.getByPlaceholder('Search for a game...')).toBeVisible();
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
// Final step
// ---------------------------------------------------------------------------

test.describe('Onboarding wizard final step', () => {
    test('final step shows Complete button instead of Next', async ({ page }) => {
        test.skip(isMobile(test.info()), 'Desktop-only — breadcrumb tap navigation may differ on mobile');

        const dialog = await openWizard(page);

        // Extract total steps from the step counter
        const stepText = await dialog.getByText(/Step 1 of \d+/).textContent();
        const totalSteps = parseInt(stepText?.match(/of (\d+)/)?.[1] ?? '0', 10);
        expect(totalSteps).toBeGreaterThanOrEqual(2);

        // Navigate to the final step via the "Personalize" breadcrumb.
        // Breadcrumbs call setCurrentStep directly, bypassing step validators.
        // Collapsed breadcrumbs may need a second click due to the expand animation.
        const personalizeBreadcrumb = dialog.getByRole('button', { name: /Personalize/ });
        await personalizeBreadcrumb.click({ force: true });

        const finalStepPattern = new RegExp(`Step ${totalSteps} of ${totalSteps}`);
        const landed = await dialog.getByText(finalStepPattern).isVisible({ timeout: 3_000 }).catch(() => false);
        if (!landed) {
            // The first click may have only expanded the breadcrumb — click again
            await personalizeBreadcrumb.click({ force: true });
        }
        await expect(dialog.getByText(finalStepPattern)).toBeVisible({ timeout: 5_000 });

        // On final step: Complete button should be visible, Next should not
        await expect(dialog.getByRole('button', { name: 'Complete' })).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByRole('button', { name: 'Next' })).not.toBeVisible();

        // Skip All should not be visible on the final step
        await expect(dialog.getByRole('button', { name: 'Skip All' })).not.toBeVisible();
    });
});
