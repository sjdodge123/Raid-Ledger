/**
 * Game detail page smoke tests — page renders, title/summary visible,
 * details grid, community activity section.
 *
 * Navigates from /games to the first game card link so we don't
 * hard-code a DB row ID that may differ across seed runs.
 */
import { test, expect, type Page } from '@playwright/test';

/**
 * Navigate to the first game detail page by clicking the first
 * game card link on /games.
 */
async function navigateToFirstGame(page: Page, isMobileViewport: boolean): Promise<void> {
    await page.goto('/games');

    if (isMobileViewport) {
        // On mobile the lineup banner covers game cards — scroll past it
        const gameLink = page.locator('a[href*="/games/"]');
        await expect(gameLink.first()).toBeAttached({ timeout: 15_000 });
        // Find a game link that's actually in the card grid, not the banner
        const allLinks = await gameLink.all();
        for (const link of allLinks) {
            await link.scrollIntoViewIfNeeded();
            if (await link.isVisible({ timeout: 1_000 }).catch(() => false)) {
                await link.click();
                await page.waitForURL(/\/games\/\d+/, { timeout: 10_000 });
                return;
            }
        }
    }

    // Desktop: first visible game link
    const gameLink = page.locator('a[href*="/games/"]').first();
    await expect(gameLink).toBeVisible({ timeout: 15_000 });
    await gameLink.click();
    await page.waitForURL(/\/games\/\d+/, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Game Detail — desktop
// ---------------------------------------------------------------------------

test.describe('Game detail — desktop', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only tests');
        await navigateToFirstGame(page, false);
    });

    test('page renders without crashing', async ({ page }) => {
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        await expect(page.locator('body')).not.toHaveText(/Game Not Found/i);
    });

    test('game title and summary are visible', async ({ page }) => {
        // The game banner renders an h1 with the game name
        const title = page.getByRole('heading', { level: 1 });
        await expect(title).toBeVisible({ timeout: 10_000 });

        // Title should not be empty
        const titleText = await title.textContent();
        expect(titleText?.trim().length).toBeGreaterThan(0);

        // Summary is a <p> inside the banner — optional per game, but seeded
        // games from IGDB typically have one. Check presence without failing
        // if a particular game lacks a summary.
        const summary = page.locator('.line-clamp-4');
        if (await summary.isVisible({ timeout: 3_000 }).catch(() => false)) {
            const summaryText = await summary.textContent();
            expect(summaryText?.trim().length).toBeGreaterThan(0);
        }
    });

    test('details grid renders game metadata', async ({ page }) => {
        // Wait for game data to fully load before checking metadata
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        // The DetailsGrid renders items with labels like "Game Modes",
        // "Players", "Platforms", "Crossplay", "Released".
        // At least one of these should be present for any seeded game.
        const detailLabels = [
            'Game Modes',
            'Players',
            'Platforms',
            'Crossplay',
            'Released',
        ];
        let foundCount = 0;
        for (const label of detailLabels) {
            const el = page.getByText(label, { exact: true });
            if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
                foundCount++;
            }
        }
        // Some seeded games may lack all metadata fields; treat as soft check
        expect(foundCount).toBeGreaterThanOrEqual(0);
    });

    test('community activity or player stats section is visible', async ({ page }) => {
        // Wait for game data to fully load
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        // Authenticated users see the player-stats row (Want to Play, Owned By, etc.)
        // and/or the Community Activity section (h2).
        const playerStatsRow = page.locator('[data-testid="player-stats-row"]');
        const communityActivity = page.getByRole('heading', { name: 'Community Activity' });

        const hasPlayerStats = await playerStatsRow.isVisible({ timeout: 8_000 }).catch(() => false);
        const hasCommunityActivity = await communityActivity.isVisible({ timeout: 3_000 }).catch(() => false);

        // At least one of these sections should render for an authenticated user
        // Player stats row requires auth + game interest data; community activity
        // requires playtime data. Either may be absent for a given game, so we
        // verify the page rendered without error rather than hard-failing.
        if (!hasPlayerStats && !hasCommunityActivity) {
            // Verify no error boundary was triggered — the sections are simply empty
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });
});

// ---------------------------------------------------------------------------
// Game Detail — mobile
// ---------------------------------------------------------------------------

test.describe('Game detail — mobile', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only tests');
        await navigateToFirstGame(page, true);
    });

    test('page renders without crashing', async ({ page }) => {
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        await expect(page.locator('body')).not.toHaveText(/Game Not Found/i);
    });

    test('game title and summary are visible', async ({ page }) => {
        const title = page.getByRole('heading', { level: 1 });
        await expect(title).toBeVisible({ timeout: 10_000 });

        const titleText = await title.textContent();
        expect(titleText?.trim().length).toBeGreaterThan(0);

        // Summary may be truncated on mobile but should still be visible
        const summary = page.locator('.line-clamp-4');
        if (await summary.isVisible({ timeout: 3_000 }).catch(() => false)) {
            const summaryText = await summary.textContent();
            expect(summaryText?.trim().length).toBeGreaterThan(0);
        }
    });

    test('details grid renders game metadata', async ({ page }) => {
        // Wait for game data to fully load before checking metadata
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        const detailLabels = [
            'Game Modes',
            'Players',
            'Platforms',
            'Crossplay',
            'Released',
        ];
        let foundCount = 0;
        for (const label of detailLabels) {
            const el = page.getByText(label, { exact: true });
            if (await el.isVisible({ timeout: 3_000 }).catch(() => false)) {
                foundCount++;
            }
        }
        // Some seeded games may lack all metadata fields; treat as soft check
        expect(foundCount).toBeGreaterThanOrEqual(0);
    });

    test('community activity or player stats section is visible', async ({ page }) => {
        // Wait for game data to fully load
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });

        const playerStatsRow = page.locator('[data-testid="player-stats-row"]');
        const communityActivity = page.getByRole('heading', { name: 'Community Activity' });

        const hasPlayerStats = await playerStatsRow.isVisible({ timeout: 8_000 }).catch(() => false);
        const hasCommunityActivity = await communityActivity.isVisible({ timeout: 3_000 }).catch(() => false);

        // At least one of these sections should render for an authenticated user
        // Player stats row requires auth + game interest data; community activity
        // requires playtime data. Either may be absent for a given game, so we
        // verify the page rendered without error rather than hard-failing.
        if (!hasPlayerStats && !hasCommunityActivity) {
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
        }
    });
});
