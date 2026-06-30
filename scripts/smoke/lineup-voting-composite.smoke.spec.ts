/**
 * ROK-1298 — Playwright smoke for the Sv Voting composite.
 *
 * Validates the rewritten voting phase on /community-lineup/:id:
 *   - JourneyHero region at the top with the Voting step badge (AC1).
 *   - Vote toggle is locatable by accessible name "Vote for Valheim"
 *     (AC3 — canonical a11y fix).
 *   - Vote bar normalized to `voteCount / votingEligibleCount`, NOT
 *     `voteCount / totalVoters` — bar must NOT be 100% on a single
 *     cast vote when the lineup has many eligible voters (AC4 —
 *     canonical regression guard).
 *   - "X/N" label appears on the row (replaces legacy "X votes").
 *   - Keyboard navigation: Tab to cover thumbnail → Enter opens game
 *     details (/games/:id). Tab to vote button → Enter toggles vote
 *     (no navigation).
 *
 * Runs in BOTH `desktop` and `mobile` Playwright projects per
 * playwright.config.ts. NEVER use `--project=desktop` locally — CLAUDE.md
 * "Smoke Test Verification" requires both viewports.
 *
 * NOTE: All assertions target the post-ROK-1298 contract. They MUST fail
 *       until the Sv composite ships.
 */
import { test, expect } from './base';
import {
    apiGet,
    apiPost,
    createLineupOrRetry,
    getAdminToken,
    API_BASE,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-voting-composite';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;
let votingLineupId: number;
let firstGameName: string;
let votingEligibleCount: number;

/** Local apiPatch — returns raw Response so callers can branch on `.ok`. */
async function apiPatchRaw(
    token: string,
    path: string,
    body: Record<string, unknown>,
) {
    return fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
}

/** Fetch the first N games from the seed/demo data, deduped by name so
 *  smoke assertions on `aria-label="Vote for {name}"` resolve uniquely
 *  even when the games table carries name-duplicate rows from prior
 *  nomination paths (see CLAUDE.md "Games-table INSERT paths must use
 *  the name-dedup guard"). */
async function fetchGames(
    token: string,
    count: number,
): Promise<Array<{ id: number; name: string }>> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length) {
        throw new Error('No games in DB — seed data missing');
    }
    const seen = new Set<string>();
    const unique: Array<{ id: number; name: string }> = [];
    for (const g of data.data as Array<{ id: number; name: string }>) {
        if (seen.has(g.name)) continue;
        seen.add(g.name);
        unique.push({ id: g.id, name: g.name });
        if (unique.length >= count) break;
    }
    if (unique.length < count) {
        throw new Error(
            `Smoke needs ${count} unique-named games, found ${unique.length}`,
        );
    }
    return unique;
}

/**
 * Set up a voting-phase lineup with multiple nominations and exactly one
 * vote cast by the admin. The bar-width invariant we assert is:
 *
 *   width === Math.round((voteCount / votingEligibleCount) * 100) %
 *
 * which for `voteCount=1` and `votingEligibleCount > 1` MUST be < 100%.
 * The legacy bug rendered this as 100%.
 */
async function setupVotingLineup(token: string): Promise<{
    lineupId: number;
    firstGameName: string;
    votingEligibleCount: number;
}> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });

    const games = await fetchGames(token, 4);

    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        },
        workerPrefix,
    );

    // Nominate 4 games (gives the leaderboard multiple rows so the
    // 1-vote bar is unambiguous).
    for (const g of games) {
        await apiPost(token, `/lineups/${lineupId}/nominate`, {
            gameId: g.id,
        });
    }

    // Advance to voting.
    await apiPatchRaw(token, `/lineups/${lineupId}/status`, {
        status: 'voting',
    });

    // Cast exactly ONE vote (admin) on the first game. Bar for that row
    // must be `1 / votingEligibleCount`, never 100% (legacy bug).
    await apiPost(token, `/lineups/${lineupId}/vote`, {
        gameId: games[0].id,
    });

    // Read back the lineup to pin the actual denominator for assertions.
    const detail = await apiGet(token, `/lineups/${lineupId}`);
    const denominator = detail?.votingEligibleCount as number | undefined;
    if (!denominator || denominator < 2) {
        // Sanity: the regression guard only proves the bug fix when the
        // denominator is > 1. Demo data must seed at least 2 community
        // members. If this throws in CI, the seed has shrunk.
        throw new Error(
            `Voting lineup setup needs votingEligibleCount >= 2, got ${denominator}`,
        );
    }

    return {
        lineupId,
        firstGameName: games[0].name,
        votingEligibleCount: denominator,
    };
}

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Voting Composite`;
    adminToken = await getAdminToken();
    const result = await setupVotingLineup(adminToken);
    votingLineupId = result.lineupId;
    firstGameName = result.firstGameName;
    votingEligibleCount = result.votingEligibleCount;
});

/**
 * ROK-1286: guard the shared voting lineup before every navigation. The
 * file-level `beforeAll` creates it once and all tests reuse `votingLineupId`;
 * if a cross-worker race or the auto-advance scheduler archived it in the
 * interim, the page would render an archived surface (no leaderboard) and the
 * downstream selectors would resolve to zero elements. Re-read the lineup and
 * rebuild it (re-pinning the module fixtures) when it's gone or archived so the
 * navigation always lands on a live voting surface.
 */
async function ensureVotingLineupLive(): Promise<void> {
    const detail = await apiGet(adminToken, `/lineups/${votingLineupId}`);
    if (detail && detail.status !== 'archived') return;
    const result = await setupVotingLineup(adminToken);
    votingLineupId = result.lineupId;
    firstGameName = result.firstGameName;
    votingEligibleCount = result.votingEligibleCount;
}

/** Navigate to the voting lineup and wait for the composite root. */
async function gotoVoting(page: import('@playwright/test').Page): Promise<void> {
    await ensureVotingLineupLive();
    await page.goto(`/community-lineup/${votingLineupId}`);
    await expect(page.locator('body')).not.toHaveText(
        /something went wrong/i,
        { timeout: 10_000 },
    );
    // Hero region is the FIRST readiness gate — JourneyHero exposes
    // role="region" with aria-labelledby pointing at the "Step 2 of 4 ·
    // Voting" badge.
    await expect(
        page.getByRole('region', { name: /step 2 of 4 · voting/i }),
    ).toBeVisible({ timeout: 20_000 });
    // K5/F3 flake fix: the JourneyHero (in the sticky header) renders
    // before VotingLeaderboardV2 finishes mapping its rows, so asserting a
    // game-row locator (the "View details for {name}" cover at AC9, or any
    // "Vote for {name}" toggle) straight after the hero raced an
    // empty/not-yet-rendered leaderboard on slow CI runners — the opener's
    // own 10s `toBeVisible` exhausted all 3 attempts. Gate on the
    // leaderboard CONTAINER and its FIRST row so every row-level locator
    // that follows resolves against a populated list. Deterministic
    // (waits on the actual rendered list, not a fixed delay) and aligned
    // with the 20s hero gate above.
    await expect(page.getByTestId('voting-leaderboard-v2')).toBeVisible({
        timeout: 20_000,
    });
    await expect(page.getByTestId('voting-row').first()).toBeVisible({
        timeout: 20_000,
    });
}

// ─────────────────────────────────────────────────────────────────────
// AC1 — JourneyHero with Voting step badge
// ─────────────────────────────────────────────────────────────────────

test.describe('Sv composite — JourneyHero (AC1)', () => {
    test('renders the JourneyHero region with the Voting step badge', async ({
        page,
    }) => {
        await gotoVoting(page);
        const hero = page.getByRole('region', {
            name: /step 2 of 4 · voting/i,
        });
        await expect(hero).toBeVisible({ timeout: 10_000 });
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC3 — Vote toggle has accessible name "Vote for {gameName}"
// ─────────────────────────────────────────────────────────────────────

test.describe('Sv composite — vote toggle a11y (AC3)', () => {
    test('vote toggle is locatable by role+name "Vote for {gameName}"', async ({
        page,
    }) => {
        await gotoVoting(page);
        // The canonical a11y fix: the legacy button had no accessible name
        // (just data-testid). Sv requires `aria-label="Vote for {name}"`
        // on every vote toggle so getByRole resolves uniquely.
        // .first() guards against the pre-existing seed-data dup that keeps
        // two `games` rows with identical names (CLAUDE.md "Games-table
        // INSERT paths must use the name-dedup guard"). AC3 requires the
        // toggle is locatable by role+name; uniqueness isn't part of the AC.
        const voteBtn = page
            .getByRole('button', {
                name: `Vote for ${firstGameName}`,
            })
            .first();
        await expect(voteBtn).toBeVisible({ timeout: 10_000 });
    });

    test('vote toggle exposes aria-pressed reflecting the cast vote', async ({
        page,
    }) => {
        await gotoVoting(page);
        // .first() guards against the pre-existing seed-data dup that keeps
        // two `games` rows with identical names (CLAUDE.md "Games-table
        // INSERT paths must use the name-dedup guard"). AC3 requires the
        // toggle is locatable by role+name; uniqueness isn't part of the AC.
        const voteBtn = page
            .getByRole('button', {
                name: `Vote for ${firstGameName}`,
            })
            .first();
        await expect(voteBtn).toBeVisible({ timeout: 10_000 });
        // Admin already cast a vote on this game in setupVotingLineup.
        await expect(voteBtn).toHaveAttribute('aria-pressed', 'true');
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC4 — Bar normalized to votingEligibleCount (NOT totalVoters)
// ─────────────────────────────────────────────────────────────────────

test.describe('Sv composite — normalized vote bars (AC4)', () => {
    test('vote bar label reads "1/N" where N is votingEligibleCount', async ({
        page,
    }) => {
        await gotoVoting(page);
        // Per spec: label format is `${voteCount}/${votingEligibleCount}`
        // e.g. "1/12". Replaces legacy "X votes" copy.
        const expected = `1/${votingEligibleCount}`;
        await expect(page.getByText(expected).first()).toBeVisible({
            timeout: 10_000,
        });
    });

    test('vote bar fill width is NOT 100% on a 1-vote, many-eligible-voter lineup', async ({
        page,
    }) => {
        await gotoVoting(page);
        // Find the bar-fill element rendered for the voted game's row.
        // Dev convention: `data-testid="vote-bar-fill"` on the inner fill div.
        const fills = page.locator('[data-testid="vote-bar-fill"]');
        await expect(fills.first()).toBeVisible({ timeout: 10_000 });

        // Assert the first row (voted, voteCount=1) renders < 100% width.
        // This is the canonical regression guard for the live-walkthrough
        // bug: legacy code divided by `totalVoters` (=1 after one vote),
        // making the bar render at 100%. Sv divides by votingEligibleCount
        // (>= 2 per setup precondition) so the bar must NOT fill the row.
        const firstFill = fills.first();
        const widthStr = await firstFill.evaluate(
            (el) => (el as HTMLElement).style.width,
        );
        // Width should be a percentage like "8%", NEVER "100%", NEVER NaN.
        expect(widthStr).not.toBe('100%');
        expect(widthStr).not.toContain('NaN');
        // Optional positive bound: must be > 0% since there IS a vote.
        const pctMatch = widthStr.match(/^(\d+(?:\.\d+)?)%$/);
        expect(pctMatch).not.toBeNull();
        const pct = pctMatch ? Number(pctMatch[1]) : NaN;
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThan(100);
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC9 — Keyboard interaction: cover Enter → game details; vote Enter → toggle
// ─────────────────────────────────────────────────────────────────────

test.describe('Sv composite — keyboard interaction (AC9)', () => {
    // ROK-1297 round 5y replaced the side-drawer with a navigation to
    // `/games/:id`. The GameResearchDrawer component still exists but
    // renders no DOM — its useEffect calls navigate() instead of opening
    // an overlay. AC9 therefore asserts URL transitions, not drawer DOM.
    test('Cover thumbnail → Enter navigates to /games/:id', async ({ page }) => {
        await gotoVoting(page);

        // ROK-1373 moved the nav affordance off the row body (desktop users
        // were yanked to /games/:id when they meant to vote). The cover
        // thumbnail is now the explicit "view details" trigger, labelled
        // `View details for {gameName}`. .first() guards the pre-existing
        // same-name seed-data dup.
        const opener = page
            .getByRole('button', {
                name: `View details for ${firstGameName}`,
            })
            .first();
        await expect(opener).toBeVisible({ timeout: 10_000 });
        await opener.focus();
        await page.keyboard.press('Enter');

        await expect(page).toHaveURL(/\/games\/\d+/, { timeout: 10_000 });
    });

    test('Tab to vote button → Enter toggles vote and does NOT navigate', async ({
        page,
    }) => {
        await gotoVoting(page);
        const initialUrl = page.url();

        // .first() guards against the pre-existing seed-data dup that keeps
        // two `games` rows with identical names (CLAUDE.md "Games-table
        // INSERT paths must use the name-dedup guard"). AC3 requires the
        // toggle is locatable by role+name; uniqueness isn't part of the AC.
        const voteBtn = page
            .getByRole('button', {
                name: `Vote for ${firstGameName}`,
            })
            .first();
        await expect(voteBtn).toBeVisible({ timeout: 10_000 });

        // Admin's vote is already cast (aria-pressed=true). Pressing Enter
        // on the focused button must un-toggle it AND must NOT navigate
        // (the vote button calls e.stopPropagation(); the row body is no
        // longer a navigation target — ROK-1373).
        await voteBtn.focus();
        await page.keyboard.press('Enter');

        // aria-pressed should flip to "false" once the vote is removed.
        await expect(voteBtn).toHaveAttribute('aria-pressed', 'false', {
            timeout: 10_000,
        });
        // URL must NOT have changed to /games/:id (no row-body bubble).
        expect(page.url()).toBe(initialUrl);
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC9 — Responsive: both desktop and mobile must pass
// ─────────────────────────────────────────────────────────────────────

test.describe('Sv composite — responsive (both viewports)', () => {
    test('renders the composite on the active viewport', async ({
        page,
    }, testInfo) => {
        await gotoVoting(page);

        const hero = page.getByRole('region', {
            name: /step 2 of 4 · voting/i,
        });
        await expect(hero).toBeVisible({ timeout: 10_000 });

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
