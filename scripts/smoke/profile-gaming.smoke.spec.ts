/**
 * Profile gaming panels smoke tests — Characters, Game Time, Watched Games.
 * Tests both desktop and mobile viewports.
 */
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Characters panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Characters (desktop)', () => {
    test('renders character list and Add Character button', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Add Character button should be visible
        await expect(page.getByRole('button', { name: 'Add Character' })).toBeVisible();

        // Seed data creates characters — at least one character link should render
        const characterLinks = page.locator('a[href*="/characters/"]');
        await expect(characterLinks.first()).toBeVisible({ timeout: 10_000 });
    });

    test('characters are grouped by game with count', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Characters are grouped under game headings (h3)
        const gameHeadings = page.locator('main h3');
        await expect(gameHeadings.first()).toBeVisible({ timeout: 10_000 });

        // Each group shows a character count like "2 characters"
        await expect(page.getByText(/\d+ characters?/).first()).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Characters panel — mobile
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Characters (mobile)', () => {
    test('renders character list and Add Character button', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Add Character button should be visible on mobile
        await expect(page.getByRole('button', { name: 'Add Character' })).toBeVisible();

        // At least one character link should render from seed data
        const characterLinks = page.locator('a[href*="/characters/"]');
        await expect(characterLinks.first()).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Game Time panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Game Time (desktop)', () => {
    test('renders availability grid with day buttons', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        // Subtitle text
        await expect(page.getByText('Set your typical weekly availability')).toBeVisible();

        // Day-of-week buttons should be visible
        await expect(page.getByRole('button', { name: 'Monday' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Friday' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday' })).toBeVisible();

        // Action buttons
        await expect(page.getByRole('button', { name: 'Absence' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Game Time panel — mobile
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Game Time (mobile)', () => {
    test('renders availability grid with day buttons', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        // Day-of-week buttons should be visible on mobile
        await expect(page.getByRole('button', { name: 'Monday' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sunday' })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Watched Games panel — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Watched Games (desktop)', () => {
    test('renders watched games grid with toggle buttons', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/watched-games');
        await expect(page.getByRole('heading', { name: 'My Watched Games' })).toBeVisible({ timeout: 15_000 });

        // Description text
        await expect(page.getByText(/Click a game to toggle your interest/)).toBeVisible();

        // At least one game toggle card should render (seed data has watched games)
        const gameButtons = page.locator('main [role="button"]').filter({ has: page.locator('h3') });
        await expect(gameButtons.first()).toBeVisible({ timeout: 10_000 });

        // Auto-heart setting should be present
        await expect(page.getByRole('heading', { name: 'Auto-heart games' })).toBeVisible();
        await expect(page.getByRole('switch')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Watched Games panel — mobile
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Watched Games (mobile)', () => {
    test('renders watched games grid', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

        await page.goto('/profile/gaming/watched-games');
        await expect(page.getByRole('heading', { name: 'My Watched Games' })).toBeVisible({ timeout: 15_000 });

        // At least one game toggle card should render
        const gameButtons = page.locator('main [role="button"]').filter({ has: page.locator('h3') });
        await expect(gameButtons.first()).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Navigation between gaming panels — desktop
// ---------------------------------------------------------------------------

test.describe('Profile gaming — sidebar navigation (desktop)', () => {
    test('sidebar links navigate between gaming panels', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar hidden on mobile');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Profile sidebar should show Gaming section links
        const sidebar = page.getByRole('navigation', { name: 'Profile navigation' });
        await expect(sidebar.getByRole('link', { name: 'Game Time' })).toBeVisible();
        await expect(sidebar.getByRole('link', { name: 'Characters' })).toBeVisible();
        await expect(sidebar.getByRole('link', { name: 'Watched Games' })).toBeVisible();

        // Navigate to Game Time via sidebar
        await sidebar.getByRole('link', { name: 'Game Time' }).click();
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 10_000 });

        // Navigate to Watched Games via sidebar
        await sidebar.getByRole('link', { name: 'Watched Games' }).click();
        await expect(page.getByRole('heading', { name: 'My Watched Games' })).toBeVisible({ timeout: 10_000 });

        // Navigate back to Characters via sidebar
        await sidebar.getByRole('link', { name: 'Characters' }).click();
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 10_000 });
    });
});
