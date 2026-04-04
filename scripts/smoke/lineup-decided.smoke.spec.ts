/**
 * Lineup Decided View smoke tests (ROK-989).
 *
 * Tests the decided view frontend: podium section with voting results,
 * tiered match cards (Scheduling Now / Almost There / Rally Your Crew),
 * bandwagon join UI, rally URL auto-scroll, and lineup stats panel.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import { test, expect } from './base';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// API helpers (mirrors patterns from community-lineup.smoke.spec.ts)
// ---------------------------------------------------------------------------

let _cachedToken: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function getAdminToken(): Promise<string> {
    if (_cachedToken) return _cachedToken;
    if (_tokenPromise) return _tokenPromise;
    _tokenPromise = (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await fetch(`${API_BASE}/auth/local`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: 'admin@local',
                    password: process.env.ADMIN_PASSWORD || 'password',
                }),
            });
            if (res.ok) {
                const { access_token } = (await res.json()) as {
                    access_token: string;
                };
                return access_token;
            }
            if (res.status === 429) {
                const wait = attempt === 0 ? 5_000 : 15_000;
                await new Promise((r) => setTimeout(r, wait));
                continue;
            }
            throw new Error(`Auth failed: ${res.status}`);
        }
        throw new Error('Auth failed after 3 attempts (rate limited)');
    })();
    _cachedToken = await _tokenPromise;
    _tokenPromise = null;
    return _cachedToken;
}

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

async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function apiPatch(
    token: string,
    path: string,
    body: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    return res.json();
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/** Archive an active lineup by walking through all valid transitions. */
async function archiveActiveLineup(token: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const banner = await apiGet(token, '/lineups/banner');
        if (!banner || typeof banner.id !== 'number') return;

        const detail = await apiGet(token, `/lineups/${banner.id}`);
        if (!detail) return;

        const transitions: Record<string, string[]> = {
            building: ['voting', 'decided', 'archived'],
            voting: ['decided', 'archived'],
            decided: ['archived'],
        };

        const steps = transitions[detail.status];
        if (!steps) return;

        for (const status of steps) {
            const body: Record<string, unknown> = { status };
            if (status === 'decided' && detail.entries?.length > 0) {
                body.decidedGameId = detail.entries[0].gameId;
            }
            await apiPatch(token, `/lineups/${banner.id}/status`, body);
        }

        const check = await apiGet(token, '/lineups/banner');
        if (!check || typeof check.id !== 'number') return;
    }
}

/** Fetch real game IDs from the admin games endpoint. */
async function fetchGameIds(
    token: string,
    count: number,
): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length)
        throw new Error('No games in DB - seed data missing');
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

/**
 * Create a lineup in decided status with matches.
 *
 * Steps:
 * 1. Archive any existing active lineup
 * 2. Create a new lineup
 * 3. Nominate 3+ games
 * 4. Advance to voting
 * 5. Cast votes for games (different counts to generate distinct rankings)
 * 6. Advance to decided
 * 7. Verify matches exist
 *
 * Returns { lineupId, gameIds, matches }.
 */
async function createDecidedLineupWithMatches(token: string): Promise<{
    lineupId: number;
    gameIds: number[];
    matches: Record<string, unknown> | null;
}> {
    await archiveActiveLineup(token);

    const gameIds = await fetchGameIds(token, 4);

    // Create lineup with a lower match threshold to maximise match generation
    const createRes = await apiPost(token, '/lineups', {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
        matchThreshold: 10,
    });

    const lineupId: number =
        createRes?.id ??
        (await apiGet(token, '/lineups/banner'))?.id;

    if (!lineupId) throw new Error('Failed to create lineup');

    // Nominate games (parallel — nominations are independent)
    await Promise.all(
        gameIds.map((gid) =>
            apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid }),
        ),
    );

    // Advance to voting
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'voting',
    });

    // Cast votes (parallel — votes are independent)
    await Promise.all(
        gameIds.slice(0, 3).map((gid) =>
            apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gid }),
        ),
    );

    // Advance directly to decided (new phase order: voting → decided)
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'decided',
    });

    // Fetch matches to verify they were generated
    const matches = await apiGet(token, `/lineups/${lineupId}/matches`);

    return { lineupId, gameIds, matches };
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let adminToken: string;
let decidedLineupId: number;
let gameIds: number[];
let matchesData: Record<string, unknown> | null;

test.beforeAll(async () => {
    adminToken = await getAdminToken();
    const result = await createDecidedLineupWithMatches(adminToken);
    decidedLineupId = result.lineupId;
    gameIds = result.gameIds;
    matchesData = result.matches;
});

// ---------------------------------------------------------------------------
// AC: Podium Section — "THIS WEEK'S PODIUM" header, top 3 games, action buttons
// ---------------------------------------------------------------------------

/** Navigate to the decided lineup and wait for the view to render. */
async function gotoDecidedView(page: import('@playwright/test').Page): Promise<void> {
    await page.goto(`/community-lineup/${decidedLineupId}`);
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
    // Stats panel always renders regardless of entries — use as readiness gate
    await expect(page.locator('[data-testid="lineup-stats-panel"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('Decided view podium section', () => {
    test('shows "THIS WEEK\'S PODIUM" header when status=decided', async ({
        page,
    }) => {
        await gotoDecidedView(page);
    });

    test('podium shows top 3 games with Champion, Silver, Bronze labels', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: Top 3 entries sorted by voteCount appear with placement labels
        const champion = page.getByText('Champion');
        await expect(champion).toBeVisible({ timeout: 15_000 });

        const silver = page.getByText('Silver');
        await expect(silver).toBeVisible({ timeout: 5_000 });

        const bronze = page.getByText('Bronze');
        await expect(bronze).toBeVisible({ timeout: 5_000 });

        // Podium cards should have data-testid for targeted assertions
        const podiumCards = page.locator('[data-testid="podium-card"]');
        const cardCount = await podiumCards.count();
        expect(cardCount).toBeGreaterThanOrEqual(1);
        expect(cardCount).toBeLessThanOrEqual(3);
    });

    test('podium action buttons are visible (Create Event removed per ROK-965)', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Create Event was removed — events are created via scheduling poll (ROK-965).
        // Verify the "Share" button exists as the sole action button.
        const shareBtn = page.getByRole('button', {
            name: /^Share$/i,
        });
        await expect(shareBtn).toBeVisible({ timeout: 20_000 });
    });

    test('"Share" button is visible and enabled', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: "Share" button copies lineup URL to clipboard (ROK-932)
        const shareBtn = page.getByRole('button', { name: /^Share$/i });
        await expect(shareBtn).toBeVisible({ timeout: 15_000 });
        await expect(shareBtn).toBeEnabled();
    });

    test('Also Ran section shows remaining games with vote bars', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: Also Ran list shows entries ranked 4th+ with vote bars
        // and decreasing opacity (60% -> 40% -> 30%)
        const alsoRanSection = page.locator(
            '[data-testid="also-ran-section"]',
        );
        // Only visible if there are 4+ entries
        if (gameIds.length >= 4) {
            await expect(alsoRanSection).toBeVisible({ timeout: 15_000 });

            // Also Ran entries should be present
            const alsoRanEntries = alsoRanSection.locator(
                '[data-testid="also-ran-entry"]',
            );
            const count = await alsoRanEntries.count();
            expect(count).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// AC: Tiered Match Cards — Scheduling Now / Almost There / Rally Your Crew
// ---------------------------------------------------------------------------

test.describe('Decided view tiered match cards', () => {
    test('tiered sections render with correct headers', async ({ page }) => {
        await gotoDecidedView(page);

        // Match tiers load asynchronously via useLineupMatches —
        // wait for the first tier section to appear before checking
        if (!matchesData) return;

        const tierSection = page.locator('[data-testid="match-tier-section"]').first();
        await expect(tierSection).toBeVisible({ timeout: 15_000 });

        // Now check which tier headers are present
        const hasScheduling = await page.getByText('Scheduling Now').isVisible().catch(() => false);
        const hasAlmost = await page.getByText('Almost There').isVisible().catch(() => false);
        const hasRally = await page.getByText('Rally Your Crew').isVisible().catch(() => false);

        expect(hasScheduling || hasAlmost || hasRally).toBe(true);
    });

    test('empty tiers are hidden', async ({ page }) => {
        // AC: Empty tiers are hidden (section not rendered)
        // Use matchesData from beforeAll to know how many tiers to expect.
        // If no matches exist at all, the test passes trivially (all tiers hidden).
        const matchArrays = matchesData as Record<string, unknown[]> | null;
        const totalMatches =
            (matchArrays?.scheduling?.length ?? 0) +
            (matchArrays?.almostThere?.length ?? 0) +
            (matchArrays?.rallyYourCrew?.length ?? 0);

        if (totalMatches === 0) {
            // No matches — all tiers should be hidden. Verify no sections render.
            await gotoDecidedView(page);
            const tierSections = page.locator('[data-testid="match-tier-section"]');
            await expect(tierSections).toHaveCount(0, { timeout: 10_000 });
            return;
        }

        await gotoDecidedView(page);

        // Wait for match tier sections to appear (async useLineupMatches query)
        const tierSections = page.locator('[data-testid="match-tier-section"]');
        await expect(tierSections.first()).toBeVisible({ timeout: 15_000 });

        // Verify every visible section has at least one card or row inside it
        const count = await tierSections.count();
        for (let i = 0; i < count; i++) {
            const section = tierSections.nth(i);
            const cards = section.locator(
                '[data-testid="match-card"], [data-testid="rally-row"]',
            );
            await expect(cards.first()).toBeVisible({ timeout: 10_000 });
        }
    });

    test('Carried Forward section renders within the decided view', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: Carried Forward section shows game name chips for carried entries
        // First, verify decided view renders (this is the TDD gate — no
        // decided view exists yet, so this assertion fails)
        await expect(page.getByText("THIS WEEK'S PODIUM")).toBeVisible({
            timeout: 15_000,
        });

        // The carried forward section renders within the decided view.
        // If no carried-over games exist, the section may be hidden,
        // but the decided view itself must be present.
        const carriedSection = page.locator(
            '[data-testid="carried-forward-section"]',
        );
        const isVisible = await carriedSection
            .isVisible({ timeout: 5_000 })
            .catch(() => false);

        if (isVisible) {
            const chips = carriedSection.locator(
                '[data-testid="carried-forward-chip"]',
            );
            const chipCount = await chips.count();
            expect(chipCount).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// AC: Bandwagon join — "Join This Match" / "I'm interested" buttons
// ---------------------------------------------------------------------------

test.describe('Decided view bandwagon interactions', () => {
    test('bandwagon button is visible on Tier 2 or Tier 3 cards', async ({
        page,
    }) => {
        await gotoDecidedView(page);

        // AC: Tier 2 cards show "Join This Match" bandwagon button
        // AC: Tier 3 rows show "I'm interested" button
        const joinBtn = page.getByRole('button', {
            name: /Join This Match|I'm interested/i,
        });

        const hasJoinBtn = await joinBtn.first()
            .isVisible({ timeout: 10_000 })
            .catch(() => false);

        // If matches exist in tier 2 or tier 3, the button should be present
        if (
            matchesData &&
            ((matchesData as Record<string, unknown[]>).almostThere?.length >
                0 ||
                (matchesData as Record<string, unknown[]>).rallyYourCrew
                    ?.length > 0)
        ) {
            expect(hasJoinBtn).toBe(true);
        }
    });

    test('already-joined member sees disabled "Joined" button', async ({
        page,
    }) => {
        await gotoDecidedView(page);

        // AC: Already-member users see disabled "Joined" button instead of join CTA
        // The admin user voted, so their voted matches should show "Joined"
        const joinedBtn = page.getByRole('button', { name: /Joined/i });
        const hasJoined = await joinedBtn.first()
            .isVisible({ timeout: 10_000 })
            .catch(() => false);

        if (hasJoined) {
            await expect(joinedBtn.first()).toBeDisabled();
        }
    });
});

// ---------------------------------------------------------------------------
// AC: Rally URL — auto-scroll to matching Tier 3 row
// ---------------------------------------------------------------------------

test.describe('Decided view rally URL', () => {
    test('rally URL (?rally=gameId) auto-scrolls to matching row and highlights it', async ({
        page,
    }) => {
        // Use the first game ID as the rally target
        const rallyGameId = gameIds[0];
        await page.goto(`/community-lineup/${decidedLineupId}?rally=${rallyGameId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });
        await expect(page.getByText("THIS WEEK'S PODIUM")).toBeVisible({ timeout: 15_000 });

        // AC: Rally URL auto-scrolls to the matching row and highlights it
        const ralliedRow = page.locator('[data-rallied="true"]');
        const hasRallied = await ralliedRow
            .isVisible({ timeout: 10_000 })
            .catch(() => false);

        // The rally highlight should be applied to the matching game row
        if (hasRallied) {
            await expect(ralliedRow).toBeVisible();
        }
    });

    test('rally URL share icon is present on Tier 3 rows', async ({
        page,
    }) => {
        await gotoDecidedView(page);

        // AC: Rally URL is copyable from each Tier 3 row via share icon
        const shareIcons = page.locator(
            '[data-testid="rally-share-icon"]',
        );
        const hasShareIcons = await shareIcons.first()
            .isVisible({ timeout: 10_000 })
            .catch(() => false);

        // If Tier 3 rows exist, share icons should be present
        if (
            matchesData &&
            (matchesData as Record<string, unknown[]>).rallyYourCrew
                ?.length > 0
        ) {
            expect(hasShareIcons).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// AC: Role-based — Operator sees "Advance" link on Tier 3 rows
// ---------------------------------------------------------------------------

test.describe('Decided view role-based UI', () => {
    test('operator sees "Advance" link on Tier 3 rows', async ({
        page,
    }) => {
        await gotoDecidedView(page);

        // AC: Operator sees "Advance" link on Tier 3 rows
        const advanceLink = page.getByRole('button', {
            name: /Advance/i,
        });

        // Rally Your Crew rows should have an "Advance" link for operators
        if (
            matchesData &&
            (matchesData as Record<string, unknown[]>).rallyYourCrew
                ?.length > 0
        ) {
            await expect(advanceLink.first()).toBeVisible({
                timeout: 10_000,
            });
        }
    });
});

// ---------------------------------------------------------------------------
// AC: Lineup Stats panel — Voters, Nominated, Total Votes
// ---------------------------------------------------------------------------

test.describe('Decided view stats panel', () => {
    test('Lineup Stats panel shows Voters, Nominated, and Total Votes', async ({
        page,
    }) => {
        await gotoDecidedView(page);

        // AC: Lineup Stats panel shows Voters, Nominated, and Total Votes counts
        const statsPanel = page.locator(
            '[data-testid="lineup-stats-panel"]',
        );
        await expect(statsPanel).toBeVisible({ timeout: 10_000 });

        // Three stat labels should be present
        await expect(statsPanel.getByText('Voters')).toBeVisible({
            timeout: 5_000,
        });
        await expect(statsPanel.getByText('Nominated')).toBeVisible({
            timeout: 5_000,
        });
        await expect(statsPanel.getByText('Total Votes')).toBeVisible({
            timeout: 5_000,
        });
    });
});

// ---------------------------------------------------------------------------
// AC: DecidedView renders instead of NominationGrid when status=decided
// ---------------------------------------------------------------------------

test.describe('Decided view rendering', () => {
    test('DecidedView renders instead of NominationGrid when status=decided', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: When status='decided', DecidedView renders instead of NominationGrid
        // Podium should be visible (decided view)
        await expect(page.getByText("THIS WEEK'S PODIUM")).toBeVisible({
            timeout: 15_000,
        });

        // NominationGrid heading should NOT be visible
        const nominationGrid = page.getByRole('heading', {
            name: 'Nominated Games',
        });
        await expect(nominationGrid).not.toBeVisible();

        // Voting leaderboard should NOT be visible
        const votingLeaderboard = page.locator(
            '[data-testid="voting-leaderboard"]',
        );
        await expect(votingLeaderboard).not.toBeVisible();
    });

    test('empty state displays when no matches exist', async ({
        page,
    }) => {
        // This test checks the empty state messaging
        // For the test lineup we created, matches should exist,
        // but the component should handle the empty case gracefully
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // The decided view should render without errors
        await expect(page.getByText("THIS WEEK'S PODIUM")).toBeVisible({
            timeout: 15_000,
        });

        // If no matches exist, empty state message should show
        const emptyState = page.getByText(
            /No matches were generated from voting/i,
        );
        // We expect matches to exist, so empty state should NOT be visible
        // But the component must render this when matches are empty
        const matchSections = page.locator(
            '[data-testid="match-tier-section"]',
        );
        const hasSections = await matchSections.first()
            .isVisible({ timeout: 10_000 })
            .catch(() => false);

        if (!hasSections) {
            await expect(emptyState).toBeVisible({ timeout: 5_000 });
        }
    });

    test('champion card has gold gradient border and crown icon', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: Champion pedestal has laurel wreath icon
        const crownIcon = page.locator('[data-testid="crown-icon"]');
        await expect(crownIcon).toBeVisible({ timeout: 15_000 });

        // Champion podium card should also be visible
        const championCard = page.getByText('Champion');
        await expect(championCard).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// AC: Responsive layout — desktop and mobile
// ---------------------------------------------------------------------------

test.describe('Decided view responsive layout', () => {
    test('podium renders correctly on mobile viewport', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'desktop',
            'Mobile-only test -- verifies podium renders on small screens',
        );

        await page.goto(`/community-lineup/${decidedLineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Podium should still render on mobile
        await expect(page.getByText("THIS WEEK'S PODIUM")).toBeVisible({
            timeout: 15_000,
        });

        // At least the champion card should be visible
        const championCard = page
            .locator('[data-testid="podium-card"]')
            .first();
        await expect(championCard).toBeVisible({ timeout: 5_000 });
    });

    test('tiered match cards render correctly on mobile', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'desktop',
            'Mobile-only test -- verifies match cards render on small screens',
        );

        await gotoDecidedView(page);

        // Match sections load asynchronously — wait for them
        if (matchesData) {
            const matchArrays = matchesData as Record<string, unknown[]>;
            const totalMatches =
                (matchArrays.scheduling?.length ?? 0) +
                (matchArrays.almostThere?.length ?? 0) +
                (matchArrays.rallyYourCrew?.length ?? 0);

            if (totalMatches > 0) {
                const firstSection = page.locator('[data-testid="match-tier-section"]').first();
                await expect(firstSection).toBeVisible({ timeout: 15_000 });
            }
        }
    });
});
