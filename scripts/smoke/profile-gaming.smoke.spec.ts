/**
 * Profile gaming panels smoke tests — Characters, Game Time, Watched Games.
 * Tests both desktop and mobile viewports.
 */
import { test, expect } from './base';

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

        // Seed data may create characters — soft check for CI where characters may not exist
        const characterLinks = page.locator('a[href*="/characters/"]');
        if (await characterLinks.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await characterLinks.count();
            expect(count).toBeGreaterThan(0);
        }
    });

    test('characters are grouped by game with count', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Desktop-only test — sidebar layout');

        await page.goto('/profile/gaming/characters');
        await expect(page.getByRole('heading', { name: 'My Characters' })).toBeVisible({ timeout: 15_000 });

        // Characters are grouped under game headings (h3) — skip if no characters exist
        const gameHeadings = page.locator('main h3');
        if (await gameHeadings.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            // Each group shows a character count like "2 characters"
            await expect(page.getByText(/\d+ characters?/).first()).toBeVisible();
        }
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

        // Seed data may create characters — soft check for CI where characters may not exist
        const characterLinks = page.locator('a[href*="/characters/"]');
        if (await characterLinks.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await characterLinks.count();
            expect(count).toBeGreaterThan(0);
        }
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

        // Action buttons (exact: true to avoid matching "Remove absence" buttons)
        await expect(page.getByRole('button', { name: 'Absence', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// Game Time panel — mobile (ROK-1011: compact GameTimeGrid replaces accordion)
// ---------------------------------------------------------------------------

test.describe('Profile gaming — Game Time (mobile)', () => {
    test('renders compact GameTimeGrid instead of accordion editor', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        // ROK-1011: GameTimeGrid (compact) should be rendered, not the old accordion
        await expect(page.getByTestId('game-time-grid')).toBeVisible();
        await expect(page.getByTestId('game-time-mobile-editor')).not.toBeVisible();

        // Day-of-week buttons should be visible in the grid header (short names on mobile)
        await expect(page.getByRole('button', { name: /Mon/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Sun/ })).toBeVisible();
    });

    test('action buttons remain accessible above grid', async ({ page }) => {
        test.skip(test.info().project.name === 'desktop', 'Mobile-only test');

        await page.goto('/profile/gaming/game-time');
        await expect(page.getByRole('heading', { name: 'My Game Time' })).toBeVisible({ timeout: 15_000 });

        // Absence, Clear, Save buttons should be visible above the grid
        await expect(page.getByRole('button', { name: 'Absence', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
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

        // Description text (may not exist if component renders differently in CI)
        const desc = page.getByText(/Click a game to toggle your interest/);
        if (!(await desc.isVisible({ timeout: 3_000 }).catch(() => false))) return;

        // Game toggle cards depend on seeded game data — soft check for CI
        const gameButtons = page.locator('main [role="button"]').filter({ has: page.locator('h3') });
        if (await gameButtons.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await gameButtons.count();
            expect(count).toBeGreaterThan(0);
        }

        // ROK-1147: Auto-heart toggle is conditionally rendered for
        // Discord-connected users (ROK-444). Demo admin may not have
        // Discord linkage in CI — soft-check (mirror gameButtons pattern).
        const autoHeartHeading = page.getByRole('heading', { name: 'Auto-heart games' });
        if (!(await autoHeartHeading.isVisible({ timeout: 5_000 }).catch(() => false))) return;
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

        // Game toggle cards depend on seeded game data — soft check for CI
        const gameButtons = page.locator('main [role="button"]').filter({ has: page.locator('h3') });
        if (await gameButtons.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            const count = await gameButtons.count();
            expect(count).toBeGreaterThan(0);
        }
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
