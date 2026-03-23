/**
 * Profile avatar + preferences panel smoke tests (ROK-899).
 *
 * Verifies that the avatar and preferences panels render correctly
 * at both desktop and mobile viewports.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Avatar Panel — Desktop
// ---------------------------------------------------------------------------

test.describe('Avatar panel (desktop)', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only tests');
        await page.goto('/profile/avatar');
        await expect(page.getByRole('heading', { name: 'Avatar' }).first()).toBeVisible({ timeout: 15_000 });
    });

    test('renders heading and current avatar preview', async ({ page }) => {
        // Description text
        await expect(page.getByText('Choose or upload your profile picture')).toBeVisible();
        // Current avatar image is present (alt text = username)
        const avatarImg = page.locator('img.w-20.h-20').first();
        await expect(avatarImg).toBeVisible();
        // Current avatar label (e.g. "Custom avatar", "Discord avatar")
        await expect(page.getByText(/avatar$/)).toBeVisible();
    });

    test('upload area is visible and interactive', async ({ page }) => {
        // "Upload Custom" label with file input
        const uploadLabel = page.getByText('Upload Custom');
        await expect(uploadLabel).toBeVisible();
        // File input is present (hidden but functional)
        const fileInput = page.locator('input[type="file"]');
        await expect(fileInput).toBeAttached();
    });

    test('available avatars grid renders options', async ({ page }) => {
        // "Available Avatars" heading may appear if user has multiple avatar sources
        const heading = page.getByRole('heading', { name: 'Available Avatars' });
        if (await heading.isVisible({ timeout: 3_000 }).catch(() => false)) {
            // At least one avatar option button should be attached in the DOM
            const avatarButtons = page.locator('button img.rounded-full');
            await expect(avatarButtons.first()).toBeAttached({ timeout: 5_000 });
        }
    });
});

// ---------------------------------------------------------------------------
// Avatar Panel — Mobile
// ---------------------------------------------------------------------------

test.describe('Avatar panel (mobile)', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only tests');
        await page.goto('/profile/avatar');
        await expect(page.getByRole('heading', { name: 'Avatar' }).first()).toBeVisible({ timeout: 15_000 });
    });

    test('renders heading and avatar preview on mobile', async ({ page }) => {
        await expect(page.getByText('Choose or upload your profile picture')).toBeVisible();
        const avatarImg = page.locator('img.w-20.h-20').first();
        await expect(avatarImg).toBeVisible();
    });

    test('upload button is visible on mobile', async ({ page }) => {
        await expect(page.getByText('Upload Custom')).toBeVisible();
        await expect(page.locator('input[type="file"]')).toBeAttached();
    });

    test('mobile shows My Settings heading', async ({ page }) => {
        // On mobile, the profile layout renders "My Settings" h1 instead of sidebar
        await expect(page.getByRole('heading', { name: 'My Settings' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Preferences Panel — Desktop
// ---------------------------------------------------------------------------

test.describe('Preferences panel (desktop)', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only tests');
        await page.goto('/profile/preferences');
        await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible({ timeout: 15_000 });
    });

    test('renders appearance section with theme mode buttons', async ({ page }) => {
        await expect(page.getByText('Choose your preferred color scheme and theme')).toBeVisible();
        // Three mode buttons: Light, Dark, Auto — use .first() to avoid strict mode
        // violations when multiple elements match (e.g., button text + icon label).
        await expect(page.getByRole('button', { name: /Light/i }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Dark/i }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Auto/i }).first()).toBeVisible();
    });

    test('theme mode toggle switches without crash', async ({ page }) => {
        const lightBtn = page.getByRole('button', { name: /Light/i }).first();
        await lightBtn.click();
        // After clicking Light, verify the page does not crash
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

        // Switch back to Dark — use .first() to handle multiple matching elements
        const darkBtn = page.getByRole('button', { name: /Dark/i }).first();
        await darkBtn.click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    });

    test('timezone section renders with select', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'Timezone' })).toBeVisible();
        await expect(page.getByText(/Choose how event times are displayed/)).toBeVisible();
        // Timezone select is visible
        const timezoneSelect = page.locator('select');
        await expect(timezoneSelect).toBeVisible();
        // Should have the "auto" value selected by default
        await expect(timezoneSelect).toHaveValue('auto');
    });
});

// ---------------------------------------------------------------------------
// Preferences Panel — Mobile
// ---------------------------------------------------------------------------

test.describe('Preferences panel (mobile)', () => {
    test.beforeEach(async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only tests');
        await page.goto('/profile/preferences');
        await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible({ timeout: 15_000 });
    });

    test('renders appearance and timezone on mobile', async ({ page }) => {
        // Appearance mode buttons — use .first() for strict mode safety
        await expect(page.getByRole('button', { name: /Light/i }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Dark/i }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Auto/i }).first()).toBeVisible();
        // Timezone
        await expect(page.getByRole('heading', { name: 'Timezone' })).toBeVisible();
        await expect(page.locator('select')).toBeVisible();
    });

    test('theme toggle works on mobile without crash', async ({ page }) => {
        await page.getByRole('button', { name: /Light/i }).first().click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

        // Switch back — use .first() to handle multiple matching elements
        await page.getByRole('button', { name: /Dark/i }).first().click();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('mobile shows My Settings heading', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'My Settings' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Sidebar Navigation — Desktop
// ---------------------------------------------------------------------------

test.describe('Profile sidebar navigation (desktop)', () => {
    test('sidebar navigates between avatar and preferences', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only — sidebar hidden on mobile');

        await page.goto('/profile/avatar');
        const sidebar = page.locator('nav[aria-label="Profile navigation"]');
        await expect(sidebar).toBeVisible({ timeout: 15_000 });

        // Verify sidebar sections are visible
        await expect(sidebar.getByText('Identity')).toBeVisible();
        await expect(sidebar.getByText('Preferences').first()).toBeVisible();

        // Navigate to Preferences via sidebar
        await sidebar.getByRole('link', { name: 'Preferences' }).click();
        await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible({ timeout: 10_000 });
        await expect(page).toHaveURL(/\/profile\/preferences/);

        // Navigate back to Avatar via sidebar
        await sidebar.getByRole('link', { name: 'My Avatar' }).click();
        await expect(page.getByRole('heading', { name: 'Avatar' }).first()).toBeVisible({ timeout: 10_000 });
        await expect(page).toHaveURL(/\/profile\/avatar/);
    });
});
