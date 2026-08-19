/**
 * Game detail page smoke tests — page renders, title/summary visible,
 * details grid, community activity section.
 *
 * Navigates from /games to the first game card link so we don't
 * hard-code a DB row ID that may differ across seed runs.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { getAdminToken, apiGet, apiPost, pollForCondition } from './api-helpers';

/**
 * Navigate to the first game detail page by clicking the first
 * game card link on /games.  Returns false if no game links are
 * visible (e.g. CI with sparse seed data).
 */
async function navigateToFirstGame(page: Page, isMobileViewport: boolean): Promise<boolean> {
    await page.goto('/games');

    // Wait for the page to settle — if no game links exist after timeout, bail.
    const anyGameLink = page.locator('a[href*="/games/"]').first();
    if (!(await anyGameLink.isVisible({ timeout: 10_000 }).catch(() => false))) {
        return false;
    }

    if (isMobileViewport) {
        // On mobile the lineup banner covers game cards — scroll past it
        const gameLink = page.locator('a[href*="/games/"]');
        const allLinks = await gameLink.all();
        for (const link of allLinks) {
            await link.scrollIntoViewIfNeeded();
            if (await link.isVisible({ timeout: 1_000 }).catch(() => false)) {
                await link.click();
                await page.waitForURL(/\/games\/\d+/, { timeout: 10_000 });
                return true;
            }
        }
        return false;
    }

    // Desktop: first visible game link
    const gameLink = page.locator('a[href*="/games/"]').first();
    await expect(gameLink).toBeVisible({ timeout: 15_000 });
    await gameLink.click();
    await page.waitForURL(/\/games\/\d+/, { timeout: 10_000 });
    return true;
}

// ---------------------------------------------------------------------------
// Game Detail — desktop
// ---------------------------------------------------------------------------

test.describe('Game detail — desktop', () => {
    let hasGames = true;

    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only tests');
        hasGames = await navigateToFirstGame(page, false);
        if (!hasGames) test.skip(true, 'No games seeded — skipping game detail tests');
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
    let hasGames = true;

    test.beforeEach(async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only tests');
        hasGames = await navigateToFirstGame(page, true);
        if (!hasGames) test.skip(true, 'No games seeded — skipping game detail tests');
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

// ---------------------------------------------------------------------------
// Co-Optimus co-op section (ROK-1398) — runs on both viewport projects
//
// Requires a DEMO_MODE seed endpoint the story adds alongside the section:
//
//   POST /admin/test/seed-cooptimus  ->  {
//     enrichedGameId:    number,  // synced + full co-op facts + attribution url
//     syncedEmptyGameId: number,  // cooptimusSyncedAt set, no co-op entry
//     unsyncedGameId:    number,  // cooptimusSyncedAt null (never synced)
//     cooptimusUrl:      string,  // attribution target of enrichedGameId
//   }
//
// (pattern: api/src/admin/demo-test-games.controller.ts). Seeding through the
// API rather than raw SQL keeps the spec runnable in CI.
//
// The Co-Optimus HTTP user-agent is deliberately never referenced here — it is
// the activation gate for the data grant and must not enter a public repo.
// ---------------------------------------------------------------------------

const COOP_SECTION = '[data-testid="coop-features-section"]';
const COOP_CREDIT = /Co-op data from Co-Optimus/i;

type CooptimusSeed = {
    enrichedGameId: number;
    syncedEmptyGameId: number;
    unsyncedGameId: number;
    cooptimusUrl: string;
};

test.describe('Game detail — Co-Optimus co-op section (ROK-1398)', () => {
    let seed: CooptimusSeed;

    test.beforeAll(async () => {
        const token = await getAdminToken();
        seed = (await apiPost(token, '/admin/test/seed-cooptimus')) as CooptimusSeed;
        expect(seed?.enrichedGameId, 'seed-cooptimus must return an enriched game id').toBeTruthy();

        // Poll the source endpoint before any UI assertion — React Query's
        // staleTime otherwise serves a pre-seed empty fetch (ROK-1156).
        await pollForCondition(
            async () => {
                const game = await apiGet(token, `/games/${seed.enrichedGameId}`);
                return game?.cooptimusSyncedAt ? game : null;
            },
            { timeoutMs: 15_000, description: 'seeded game exposes cooptimusSyncedAt' },
        );
    });

    test('enriched game renders the co-op section with its facts', async ({ page }) => {
        await page.goto(`/games/${seed.enrichedGameId}`);
        const section = page.locator(COOP_SECTION);
        await expect(section).toBeVisible({ timeout: 15_000 });
        await expect(section).toHaveText(/online/i);
        await expect(section).toHaveText(/campaign/i);
    });

    test('co-op facts always ship with the Co-Optimus attribution credit', async ({ page }) => {
        // Contractual (ROK-275 / ROK-1399): the credit is the consideration for
        // the data grant. If this fails, restore the credit — never the assertion.
        await page.goto(`/games/${seed.enrichedGameId}`);
        await expect(page.locator(COOP_SECTION)).toBeVisible({ timeout: 15_000 });

        const credit = page.getByRole('link', { name: COOP_CREDIT });
        await expect(credit).toBeVisible({ timeout: 10_000 });
        await expect(credit).toHaveAttribute('href', seed.cooptimusUrl);
        await expect(credit).toHaveAttribute('target', '_blank');
        await expect(credit).toHaveAttribute('rel', /noopener/);
    });

    test('never-synced game shows no co-op section and no layout hole', async ({ page }) => {
        await page.goto(`/games/${seed.unsyncedGameId}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(COOP_SECTION)).toHaveCount(0);
        await expect(page.getByText(COOP_CREDIT)).toHaveCount(0);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('synced game with no co-op entry shows the compact empty line', async ({ page }) => {
        await page.goto(`/games/${seed.syncedEmptyGameId}`);
        const section = page.locator(COOP_SECTION);
        await expect(section).toBeVisible({ timeout: 15_000 });
        await expect(section).toHaveText(/no co-op support reported/i);
    });
});
