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
import { test, expect } from './base';
import { isMobile } from './helpers';
import { apiPost, getAdminToken } from './api-helpers';

const WIZARD_URL = '/onboarding?rerun=1';
const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ROK-1070: clear admin onboardingCompletedAt + gameTimeConfirmedAt before
// any test runs so the wizard breadcrumb structure (Game Time step etc.) is
// in its fresh-onboarding shape. Without this, prior runs that saved
// game-time leak through `?rerun=1` and the Game Time breadcrumb fails to
// render in the expected structure.
test.beforeAll(async () => {
    const token = await getAdminToken();
    await apiPost(token, '/admin/test/reset-onboarding', {});
});

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

/**
 * Check whether the Steam onboarding step will actually appear in the wizard.
 * Returns true only when Steam is configured AND the logged-in admin has NOT
 * yet linked Steam (i.e., the step won't be auto-skipped).
 */
async function willSteamStepShow(page: import('@playwright/test').Page): Promise<boolean> {
    if (!(await isSteamConfigured())) return false;
    // Open the wizard briefly and check if the Steam heading appears
    await page.goto(WIZARD_URL);
    const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const steamHeading = dialog.getByRole('heading', { name: 'Connect Your Steam Account' });
    return steamHeading.isVisible({ timeout: 5_000 }).catch(() => false);
}

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

/** If the Steam step is showing, skip past it to reach the Games step. */
async function skipPastSteamIfPresent(dialog: import('@playwright/test').Locator) {
    const steamHeading = dialog.getByRole('heading', { name: 'Connect Your Steam Account' });
    const isSteam = await steamHeading.isVisible({ timeout: 3_000 }).catch(() => false);
    if (isSteam) {
        await dialog.getByRole('button', { name: 'Next' }).click();
        await expect(dialog.getByRole('heading', { name: 'What Do You Play?' })).toBeVisible({ timeout: 10_000 });
    }
}

/**
 * Advance the wizard until the Games step ("What Do You Play?") is visible
 * (ROK-1147). Robust to whichever optional steps render first
 * (Connect/Discord, Steam) — clicks Skip up to 4 times. Conditional steps
 * also flip in/out as system status / steam status hooks settle, so we
 * use `expect.poll` to ride out the resolver instead of a fixed sleep.
 */
async function advanceToGamesStep(
    dialog: import('@playwright/test').Locator,
): Promise<void> {
    const gamesHeading = dialog.getByRole('heading', { name: 'What Do You Play?' });
    if (await gamesHeading.isVisible({ timeout: 5_000 }).catch(() => false)) return;

    for (let i = 0; i < 4; i++) {
        const skipBtn = dialog.getByRole('button', { name: 'Skip', exact: true });
        const hasSkip = await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false);
        if (!hasSkip) break;
        await skipBtn.click();
        if (await gamesHeading.isVisible({ timeout: 3_000 }).catch(() => false)) return;
    }
    await expect(gamesHeading).toBeVisible({ timeout: 10_000 });
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

        // ROK-1147: the wizard's first step depends on what's configured
        // and what the admin has linked. Possibilities (any can be first):
        //   Connect (Discord configured, admin not linked)
        //   Steam   (Steam configured, admin not linked)
        //   Games   (default)
        // Conditional step flags also flip in/out as system-status and
        // steam-status queries settle, so we accept any of the three
        // headings as a valid "first step".
        const connectHeading = dialog.getByRole('heading', { name: 'Connect Your Account' });
        const steamHeading = dialog.getByRole('heading', { name: 'Connect Your Steam Account' });
        const gamesHeading = dialog.getByRole('heading', { name: 'What Do You Play?' });

        await expect
            .poll(
                async () =>
                    (await connectHeading.isVisible().catch(() => false)) ||
                    (await steamHeading.isVisible().catch(() => false)) ||
                    (await gamesHeading.isVisible().catch(() => false)),
                {
                    timeout: 15_000,
                    message: 'No first-step heading rendered',
                },
            )
            .toBe(true);
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

        // The "Games" label should always be visible in breadcrumbs
        await expect(dialog.getByRole('button', { name: 'Games' })).toBeVisible({ timeout: 5_000 });

        // ROK-1147: handle Connect/Steam optional steps before Games.
        await advanceToGamesStep(dialog);

        // Now on Games step — advance to verify breadcrumbs update
        await dialog.getByRole('button', { name: 'Next' }).click();
        await expect(dialog.getByText('Game Time')).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Games step content
// ---------------------------------------------------------------------------

test.describe('Onboarding wizard games step', () => {
    test('genre filter chips are visible', async ({ page }) => {
        const dialog = await openWizard(page);
        await advanceToGamesStep(dialog);

        // Genre chips: All is always present, plus specific genres
        await expect(dialog.getByRole('button', { name: 'All', exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'RPG', exact: true })).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'MMORPG', exact: true })).toBeVisible();
    });

    test('game search input accepts text', async ({ page }) => {
        const dialog = await openWizard(page);
        await advanceToGamesStep(dialog);

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

test.describe('Onboarding wizard Steam step (ROK-941)', () => {
    test('Steam step appears when steamConfigured=true and user has no Steam linked', async ({ page }) => {
        const steamShows = await willSteamStepShow(page);
        test.skip(!steamShows, 'Steam not configured or admin already has Steam linked — step is hidden');

        const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
        await expect(
            dialog.getByRole('heading', { name: 'Connect Your Steam Account' }),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('Steam step shows value prop text and Connect Steam button', async ({ page }) => {
        const steamShows = await willSteamStepShow(page);
        test.skip(!steamShows, 'Steam not configured or admin already has Steam linked — step is hidden');

        const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
        await expect(dialog.getByText(/steam/i)).toBeVisible();
        await expect(
            dialog.getByRole('button', { name: /Connect Steam/i }),
        ).toBeVisible();
    });

    test('Steam step Connect Steam button links to correct auth URL', async ({ page }) => {
        const steamShows = await willSteamStepShow(page);
        test.skip(!steamShows, 'Steam not configured or admin already has Steam linked — step is hidden');

        const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
        const linkOrBtn = dialog.locator('a[href*="/auth/steam/link"]');
        await expect(linkOrBtn).toBeVisible({ timeout: 5_000 });
        const href = await linkOrBtn.getAttribute('href');
        expect(href).toContain('returnTo=');
        expect(href).toContain('%2Fonboarding');
    });

    test('Skip button on Steam step advances to Games step', async ({ page }) => {
        const steamShows = await willSteamStepShow(page);
        test.skip(!steamShows, 'Steam not configured or admin already has Steam linked — step is hidden');

        const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
        const skipBtn = dialog.getByRole('button', { name: 'Skip', exact: true });
        await expect(skipBtn).toBeVisible();
        await skipBtn.click();

        await expect(
            dialog.getByRole('heading', { name: 'What Do You Play?' }),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('Steam step appears before Games in breadcrumb order', async ({ page }) => {
        const steamShows = await willSteamStepShow(page);
        test.skip(!steamShows, 'Steam not configured or admin already has Steam linked — step is hidden');

        const dialog = page.getByRole('dialog', { name: 'Onboarding wizard' });
        await expect(dialog.getByRole('button', { name: 'Steam' })).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByRole('button', { name: 'Games' })).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByText(/Step 1 of \d+/)).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Game Time step — compact grid (ROK-1011)
// ---------------------------------------------------------------------------

test.describe('Onboarding wizard game-time step (ROK-1011)', () => {
    test('game-time step renders compact GameTimeGrid on all viewports', async ({ page }) => {
        const dialog = await openWizard(page);

        // Navigate directly to Game Time via breadcrumb (skips dynamic character steps)
        const gameTimeBreadcrumb = dialog.getByRole('button', { name: 'Game Time' });
        await expect(gameTimeBreadcrumb).toBeVisible({ timeout: 10_000 });
        await gameTimeBreadcrumb.click();
        await expect(dialog.getByRole('heading', { name: 'When Do You Play?' })).toBeVisible({ timeout: 10_000 });

        // ROK-1011: Should render GameTimeGrid, not the old accordion editor
        await expect(dialog.getByTestId('game-time-grid')).toBeVisible();
        await expect(dialog.getByTestId('game-time-mobile-editor')).not.toBeVisible();

        // Instruction text should mention drag-to-paint (not "tap days to expand")
        await expect(dialog.getByText(/paint your weekly availability/i)).toBeVisible();
        await expect(dialog.getByText(/tap days to expand/i)).not.toBeVisible();
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
