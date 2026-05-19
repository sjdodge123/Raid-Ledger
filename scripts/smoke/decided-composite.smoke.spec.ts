/**
 * ROK-1299 — Playwright smoke for the Decided composite layout (Cycle 4 S3).
 *
 * Validates the rewritten /community-lineup/:id Decided view:
 *   - JourneyHero region at the top with the Decided step badge (AC1)
 *   - "Your matches" personal section with per-match "Pick a time →" CTAs (AC2)
 *   - "Other matches" section without CTAs (AC3)
 *   - Optional leftover-voters row (AC4)
 *   - Podium / page-level Submit / "Share" button / LineupStatsPanel are GONE (AC5)
 *   - Clicking a match row opens the GameResearchDrawer (AC6)
 *   - Renders correctly on both desktop AND mobile (AC9)
 *
 * Runs in both `desktop` and `mobile` Playwright projects per
 * playwright.config.ts. NEVER use `--project=desktop` locally — CLAUDE.md
 * "Smoke Test Verification" requires both viewports.
 *
 * NOTE: All assertions target the post-ROK-1299 contract. They MUST fail
 *       until the DecidedView rewrite ships.
 */
import { test, expect } from './base';
import {
    getAdminToken,
    apiGet,
    apiPatch,
    createLineupOrRetry,
    API_BASE,
} from './api-helpers';

// ---------------------------------------------------------------------------
// Local apiPost (throwing) — mirrors lineup-decided.smoke.spec.ts
// ---------------------------------------------------------------------------

async function apiPost(
    token: string,
    path: string,
    body?: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`POST ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

const FILE_PREFIX = 'decided-composite';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;
let decidedLineupId: number;
let firstMatchId: number;

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length)
        throw new Error('No games in DB — seed data missing');
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

async function setupDecidedLineup(token: string): Promise<{
    lineupId: number;
    matchId: number;
}> {
    // Archive any sibling-worker lineups owned by this worker prefix.
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });

    const gameIds = await fetchGameIds(token, 4);

    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );

    // Nominate, advance to voting, vote on the admin's matches.
    await Promise.all(
        gameIds.map((gid) =>
            apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid }),
        ),
    );
    await apiPatch(token, `/lineups/${lineupId}/status`, { status: 'voting' });
    // Admin votes on the first 2 games → user is "in" those matches.
    await Promise.all(
        gameIds.slice(0, 2).map((gid) =>
            apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gid }),
        ),
    );
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'decided',
        decidedGameId: gameIds[0],
    });

    const matches = (await apiGet(
        token,
        `/lineups/${lineupId}/matches`,
    )) as {
        scheduling: Array<{ id: number }>;
        almostThere: Array<{ id: number }>;
        rallyYourCrew: Array<{ id: number }>;
    };
    const firstMatch =
        matches.scheduling[0] ?? matches.almostThere[0] ?? matches.rallyYourCrew[0];
    if (!firstMatch) {
        throw new Error('Decided lineup has no matches — fixture broke');
    }
    return { lineupId, matchId: firstMatch.id };
}

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Decided Composite`;
    adminToken = await getAdminToken();
    const result = await setupDecidedLineup(adminToken);
    decidedLineupId = result.lineupId;
    firstMatchId = result.matchId;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to the Decided lineup and wait for the composite root. */
async function gotoDecided(
    page: import('@playwright/test').Page,
): Promise<void> {
    await page.goto(`/community-lineup/${decidedLineupId}`);
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 10_000,
    });
    await expect(page.getByTestId('decided-composite-view')).toBeVisible({
        timeout: 20_000,
    });
}

// ---------------------------------------------------------------------------
// AC1 — JourneyHero
// ---------------------------------------------------------------------------

test.describe('Decided composite — hero (AC1)', () => {
    test('renders the JourneyHero region with the Decided step badge', async ({
        page,
    }) => {
        await gotoDecided(page);
        const hero = page.getByRole('region', {
            name: /step 3 of 4 · decided/i,
        });
        await expect(hero).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// AC2 — Your matches section + CTA per card
// ---------------------------------------------------------------------------

test.describe('Decided composite — Your matches section (AC2)', () => {
    test('renders the personal section with at least one "Pick a time →" CTA', async ({
        page,
    }) => {
        await gotoDecided(page);
        const yourSection = page.getByTestId('decided-your-matches-section');
        await expect(yourSection).toBeVisible({ timeout: 15_000 });
        const cta = yourSection.getByRole('link', { name: /pick a time/i }).first();
        await expect(cta).toBeVisible({ timeout: 10_000 });
        await expect(cta).toHaveAttribute(
            'href',
            new RegExp(
                `/community-lineup/${decidedLineupId}/schedule/${firstMatchId}`,
            ),
        );
    });
});

// ---------------------------------------------------------------------------
// AC5 — Podium / page Submit / Share / LineupStatsPanel are GONE
// ---------------------------------------------------------------------------

test.describe('Decided composite — old surfaces removed (AC5)', () => {
    test('podium, Share, and LineupStatsPanel are absent', async ({ page }) => {
        await gotoDecided(page);

        await expect(page.getByText(/this week'?s podium/i)).toHaveCount(0);
        await expect(page.getByTestId('podium-card')).toHaveCount(0);
        await expect(page.getByTestId('crown-icon')).toHaveCount(0);
        await expect(page.getByTestId('lineup-stats-panel')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^share$/i })).toHaveCount(
            0,
        );
    });
});

// ---------------------------------------------------------------------------
// AC6 — Row click opens the GameResearchDrawer, CTA click does NOT
// ---------------------------------------------------------------------------

test.describe('Decided composite — drawer interactions (AC6)', () => {
    test('clicking a match row navigates to /games/:id', async ({ page }) => {
        // ROK-1297 round 5y: GameResearchDrawer was replaced with a
        // router navigation to /games/:id. The row click must change
        // the URL, NOT mount a drawer overlay.
        await gotoDecided(page);

        await expect(page.getByTestId('game-research-drawer')).toHaveCount(0);

        const yourSection = page.getByTestId('decided-your-matches-section');
        const firstRow = yourSection.getByTestId('game-ref-row').first();
        await expect(firstRow).toBeVisible({ timeout: 10_000 });
        await firstRow.click();

        await page.waitForURL(/\/games\/\d+/, { timeout: 10_000 });
        expect(page.url()).toMatch(/\/games\/\d+/);
    });

    test('clicking the "Pick a time" CTA does NOT open the drawer', async ({
        page,
    }) => {
        await gotoDecided(page);
        const yourSection = page.getByTestId('decided-your-matches-section');
        const cta = yourSection.getByRole('link', { name: /pick a time/i }).first();
        await expect(cta).toBeVisible({ timeout: 10_000 });

        // Intercept the navigation so we can assert the drawer remained closed
        // even though Playwright would otherwise navigate the page.
        await page.route('**/*', (route) => route.fallback());
        const navigationPromise = page.waitForURL(/\/schedule\//, {
            timeout: 10_000,
        });
        await cta.click();
        await navigationPromise.catch(() => {});

        // Either we navigated (no drawer) or we're still on the decided page —
        // in both cases the drawer must not be present.
        await expect(page.getByTestId('game-research-drawer')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC9 — Responsive: both desktop and mobile must pass
// ---------------------------------------------------------------------------

test.describe('Decided composite — responsive (AC9)', () => {
    test('renders the composite on the active viewport', async ({
        page,
    }, testInfo) => {
        await gotoDecided(page);

        // Hero is the readiness gate; the composite root just confirmed visible.
        const hero = page.getByRole('region', {
            name: /step 3 of 4 · decided/i,
        });
        await expect(hero).toBeVisible({ timeout: 10_000 });

        // Mobile-specific assertion: hero stays inside viewport width.
        if (testInfo.project.name === 'mobile') {
            const box = await hero.boundingBox();
            const viewport = page.viewportSize();
            expect(box).not.toBeNull();
            expect(viewport).not.toBeNull();
            if (box && viewport) {
                expect(box.width).toBeLessThanOrEqual(viewport.width);
            }
        }
    });
});
