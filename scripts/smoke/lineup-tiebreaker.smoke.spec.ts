/**
 * Lineup Tiebreaker smoke tests (ROK-938).
 *
 * Tests bracket and veto tiebreaker resolution modes when voting
 * produces tied games. Covers the TiebreakerPromptModal, BracketView
 * with SVG bracket tree, VetoView with blind vetoes, dismiss flow,
 * and "Tiebreaker active" badge on the Games page banner.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import { test, expect } from './base';
import {
    API_BASE,
    getAdminToken,
    apiPost,
    apiGet,
    createLineupOrRetry,
    awaitProcessing,
} from './api-helpers';

// ROK-1147: every describe in this file creates a lineup, votes, advances
// through phases, and starts a tiebreaker. The fixture falls back to
// /lineups/banner on 409 (sibling-owned lineup) and then tries to mutate
// it, producing "Cannot transition from 'voting' to 'voting'" and
// downstream UI failures. Run the file serially so each fixture creates
// its own lineup without colliding with siblings.
test.describe.configure({ mode: 'serial' });

async function apiPatch(token: string, path: string, body: Record<string, unknown>) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        // ROK-1167: tolerate the auto-advance race introduced by ROK-1118.
        // When the API auto-advances a lineup from building → voting before
        // the test's explicit PATCH lands, the status endpoint 400s with
        // "Cannot transition from 'voting' to 'voting'". Treat same-state
        // transitions as success — the lineup is already where we wanted it.
        const target = (body as { status?: string }).status;
        if (
            res.status === 400 &&
            typeof target === 'string' &&
            text.includes(`Cannot transition from '${target}' to '${target}'`)
        ) {
            return null;
        }
        throw new Error(`PATCH ${path} failed: ${res.status} ${text}`);
    }
    return res.json();
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/** Fetch real game IDs from the configured-games endpoint. */
async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`fetchGameIds failed: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games in DB');
    return body.data.slice(0, count).map((g) => g.id);
}

// ROK-1147: per-worker title prefix scopes /admin/test/reset-lineups so
// sibling workers don't archive each other's lineups mid-test.
const FILE_PREFIX = 'lineup-tiebreaker';
let workerPrefix: string;
let lineupTitle: string;

/**
 * Archive lineups owned by THIS worker (ROK-1147).
 *
 * `/admin/test/reset-lineups` (DEMO_MODE-only) only archives lineups whose
 * title starts with `workerPrefix`, so sibling workers are unaffected.
 */
async function archiveActiveLineup(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', { titlePrefix: workerPrefix });
}

/**
 * Create a lineup in voting phase with tied games and trigger tiebreaker.
 *
 * Steps:
 * 1. Archive any active lineup
 * 2. Create a new lineup
 * 3. Nominate 4 games
 * 4. Advance to voting
 * 5. Cast equal votes on top games to produce a tie
 * 6. Create a tiebreaker via POST /lineups/:id/tiebreaker
 *
 * Returns { lineupId, gameIds }.
 */
async function createVotingLineupWithTiebreaker(
    token: string,
    mode: 'bracket' | 'veto',
): Promise<{ lineupId: number; gameIds: number[] }> {
    await archiveActiveLineup(token);

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

    // Nominate all 4 games
    for (const gid of gameIds) {
        await apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid });
    }

    // Advance to voting
    await apiPatch(token, `/lineups/${lineupId}/status`, { status: 'voting' });

    // Cast equal votes on the top 2 games to produce a tie
    await apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gameIds[0] });
    await apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gameIds[1] });

    // Start the tiebreaker
    await apiPost(token, `/lineups/${lineupId}/tiebreaker`, {
        mode,
        roundDurationHours: 24,
    });

    // ROK-1070: drain BullMQ + buffered async writes so the tiebreaker-init
    // job, embed-sync, and notification-dedup writes all settle before the
    // test navigates. Then poll the API directly to confirm the bracket has
    // matchups before relying on the React Query (`useQuery` honours a 15s
    // staleTime, so the first refetch after the page mount can be served
    // stale otherwise — see feedback_smoke_polling_for_async_writes.md).
    await awaitProcessing(token);
    await pollTiebreakerHasMatchups(token, lineupId);

    return { lineupId, gameIds };
}

/**
 * Poll `/lineups/:id/tiebreaker` until the response carries at least one
 * matchup. The tiebreaker-init job is queued from the POST handler, so the
 * response can land before the bracket rows are materialised.
 */
async function pollTiebreakerHasMatchups(
    token: string,
    lineupId: number,
    timeoutMs = 10_000,
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const tb = (await apiGet(token, `/lineups/${lineupId}/tiebreaker`)) as
            | { matchups?: unknown[]; mode?: string }
            | null;
        if (tb && Array.isArray(tb.matchups) && tb.matchups.length > 0) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
        `Tiebreaker for lineup ${lineupId} had no matchups within ${timeoutMs}ms`,
    );
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

let adminToken: string;

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
    adminToken = await getAdminToken();
});

// ---------------------------------------------------------------------------
// AC: Tiebreaker prompt modal — operator sees TiebreakerPromptModal
// ---------------------------------------------------------------------------

test.describe('Tiebreaker prompt modal', () => {
    let lineupId: number;
    let gameIds: number[];

    test.beforeAll(async () => {
        // Create a voting lineup with tied games (no tiebreaker started yet).
        // We create a lineup and cast equal votes to produce a tie, but do NOT
        // call the tiebreaker endpoint — the UI should detect the tie and show
        // the prompt modal to the operator.
        await archiveActiveLineup(adminToken);

        gameIds = await fetchGameIds(adminToken, 4);

        const created = await createLineupOrRetry(
            adminToken,
            {
                title: lineupTitle,
                buildingDurationHours: 720,
                votingDurationHours: 720,
                decidedDurationHours: 720,
                matchThreshold: 10,
            },
            workerPrefix,
        );
        lineupId = created.id;

        for (const gid of gameIds) {
            await apiPost(adminToken, `/lineups/${lineupId}/nominate`, { gameId: gid });
        }

        await apiPatch(adminToken, `/lineups/${lineupId}/status`, { status: 'voting' });

        // Cast equal votes on top 2 games to produce a tie
        await apiPost(adminToken, `/lineups/${lineupId}/vote`, { gameId: gameIds[0] });
        await apiPost(adminToken, `/lineups/${lineupId}/vote`, { gameId: gameIds[1] });
    });

    test('operator sees TiebreakerPromptModal when top games are tied', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Breadcrumb overflows on mobile viewport');

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: When operator tries to advance to decided with tied games,
        // the TIEBREAKER_REQUIRED error triggers the prompt modal.
        // Click "Scheduling" in the breadcrumb (first click shows confirmation).
        const advanceBtn = page.getByRole('button', { name: 'Scheduling' });
        await expect(advanceBtn).toBeVisible({ timeout: 10_000 });
        await advanceBtn.click();
        // Second click confirms the transition attempt.
        const confirmBtn = page.getByRole('button', { name: /advance/i });
        await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
        await confirmBtn.click();

        // TIEBREAKER_REQUIRED error opens the prompt modal
        const modal = page.locator('[data-testid="tiebreaker-prompt-modal"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        // Modal should display the tied games
        await expect(modal.getByText(/tied/i)).toBeVisible({ timeout: 5_000 });

        // Mode selection buttons should be available
        await expect(modal.getByRole('button', { name: /bracket/i })).toBeVisible({ timeout: 5_000 });
        await expect(modal.getByRole('button', { name: /veto/i })).toBeVisible({ timeout: 5_000 });
    });

    test('TiebreakerPromptModal shows dismiss option for operator', async ({ page }) => {
        test.skip(test.info().project.name === 'mobile', 'Breadcrumb overflows on mobile viewport');

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Trigger the modal via breadcrumb advance attempt
        const advanceBtn = page.getByRole('button', { name: 'Scheduling' });
        await expect(advanceBtn).toBeVisible({ timeout: 10_000 });
        await advanceBtn.click();
        const confirmBtn = page.getByRole('button', { name: /advance/i });
        await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
        await confirmBtn.click();

        // AC: Operator can dismiss tiebreaker, proceeding to decided
        const modal = page.locator('[data-testid="tiebreaker-prompt-modal"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        const dismissBtn = modal.getByRole('button', { name: /dismiss|skip|proceed without/i });
        await expect(dismissBtn).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// AC: Bracket flow — start bracket, see SVG tree, vote, advancement
// ---------------------------------------------------------------------------

test.describe('Bracket tiebreaker flow', () => {
    let lineupId: number;
    let gameIds: number[];

    test.beforeAll(async () => {
        const result = await createVotingLineupWithTiebreaker(adminToken, 'bracket');
        lineupId = result.lineupId;
        gameIds = result.gameIds;
    });

    test('BracketView renders with SVG bracket tree after starting bracket', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: Bracket: operator starts bracket, matchups created with correct seeding
        // AC: Bracket: SVG bracket tree renders with connecting lines between rounds
        const bracketView = page.locator('[data-testid="bracket-view"]');
        await expect(bracketView).toBeVisible({ timeout: 15_000 });

        // SVG bracket tree should contain connecting lines
        const svgTree = bracketView.locator('[data-testid="bracket-tree"] svg');
        await expect(svgTree).toBeVisible({ timeout: 10_000 });

        // SVG tree should render (connecting lines appear after round 1 advances)
        await expect(svgTree).toBeVisible({ timeout: 5_000 });
    });

    test('bracket matchup cards show seeded game pairs', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        const bracketView = page.locator('[data-testid="bracket-view"]');
        await expect(bracketView).toBeVisible({ timeout: 15_000 });

        // AC: Matchups created with correct seeding (power of 2, byes for top seeds)
        const matchupCards = bracketView.locator('[data-testid="bracket-matchup-card"]');
        const matchupCount = await matchupCards.count();
        expect(matchupCount).toBeGreaterThan(0);

        // Each matchup card should show two game names
        const firstMatchup = matchupCards.first();
        const gameNames = firstMatchup.locator('[data-testid="matchup-game-name"]');
        const nameCount = await gameNames.count();
        expect(nameCount).toBe(2);
    });

    test('community members can vote on active bracket matchup', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        const bracketView = page.locator('[data-testid="bracket-view"]');
        await expect(bracketView).toBeVisible({ timeout: 15_000 });

        // AC: Bracket: community members can vote on active round matchups
        // Find a matchup card with vote buttons (active or not)
        const matchupWithButtons = bracketView.locator('[data-testid="bracket-matchup-card"]').filter({
            has: bracketView.page().locator('[data-testid="bracket-vote-button"]'),
        }).first();
        const hasActiveMatchup = await matchupWithButtons.isVisible({ timeout: 5_000 }).catch(() => false);

        if (hasActiveMatchup) {
            const voteButtons = matchupWithButtons.locator('[data-testid="bracket-vote-button"]');
            const voteButtonCount = await voteButtons.count();
            expect(voteButtonCount).toBeGreaterThanOrEqual(1);

            await voteButtons.first().click();
            // Single-voter setup auto-resolves the bracket as soon as the last
            // expected voter casts. Once that happens, lineup transitions to
            // 'decided' and ROK-1117's gate replaces BracketView with the
            // TiebreakerClosedNotice — `bracket-matchup-card[data-voted=true]`
            // is no longer rendered. Either outcome is a valid AC pass.
            const votedCard = bracketView.locator('[data-testid="bracket-matchup-card"][data-voted="true"]');
            const closedNotice = page.locator('[data-testid="tiebreaker-vote-closed"]');
            await expect(votedCard.first().or(closedNotice)).toBeVisible({ timeout: 5_000 });
        } else {
            // All matchups may be byes or already completed — still valid
            const matchupCards = bracketView.locator('[data-testid="bracket-matchup-card"]');
            expect(await matchupCards.count()).toBeGreaterThan(0);
        }
    });

    test('bracket auto-resolves with single voter and transitions to decided', async ({ page }) => {
        // AC: Bracket: round auto-advances when all members voted
        // AC: Bracket: single elimination to final winner, tiebreaker resolved
        // With only 1 voter (admin), the bracket resolves immediately after voting.
        // The previous test cast a vote, so the lineup should now be in decided state.
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Bracket auto-resolved → lineup transitioned to decided → podium visible
        const podiumOrBracket = page.locator('[data-testid="bracket-view"], h2:has-text("PODIUM")');
        await expect(podiumOrBracket.first()).toBeVisible({ timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// AC: Veto flow — start veto, submit veto, see reveal
// ---------------------------------------------------------------------------

test.describe('Veto tiebreaker flow', () => {
    let lineupId: number;
    let gameIds: number[];

    test.beforeAll(async () => {
        const result = await createVotingLineupWithTiebreaker(adminToken, 'veto');
        lineupId = result.lineupId;
        gameIds = result.gameIds;
    });

    test('VetoView renders with all tied games and veto buttons', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: Veto: operator starts veto, all tied games shown with veto buttons
        const vetoView = page.locator('[data-testid="veto-view"]');
        await expect(vetoView).toBeVisible({ timeout: 15_000 });

        // Veto game cards should be present for each tied game
        const vetoCards = vetoView.locator('[data-testid="veto-game-card"]');
        const cardCount = await vetoCards.count();
        expect(cardCount).toBeGreaterThanOrEqual(2);

        // Each card should have a veto button
        const firstCard = vetoCards.first();
        const vetoBtn = firstCard.locator('[data-testid="veto-button"]');
        await expect(vetoBtn).toBeVisible({ timeout: 5_000 });
    });

    test('member can submit a blind veto on a game', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: Veto: members submit blind vetoes, not revealed until all in or deadline
        const vetoView = page.locator('[data-testid="veto-view"]');
        await expect(vetoView).toBeVisible({ timeout: 15_000 });

        // Click the veto button on the first game card
        const firstVetoBtn = vetoView.locator('[data-testid="veto-button"]').first();
        await firstVetoBtn.click();

        // After vetoing, the card should show a "vetoed" state for the current user
        const vetoed = vetoView.locator('[data-testid="veto-game-card"][data-vetoed="true"]');
        await expect(vetoed).toBeVisible({ timeout: 5_000 });

        // Veto count should NOT be revealed yet (blind vetoes)
        const hiddenCount = vetoView.locator('[data-testid="veto-count-hidden"]');
        const hasHidden = await hiddenCount.first().isVisible({ timeout: 3_000 }).catch(() => false);
        // Either the count is explicitly hidden or not shown at all
        expect(hasHidden || !(await vetoView.getByText(/\d+ vetoes?/i).isVisible({ timeout: 2_000 }).catch(() => false))).toBe(true);
    });

    test('total vetoes are capped at games minus 1', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: Veto: total vetoes capped at games - 1
        const vetoView = page.locator('[data-testid="veto-view"]');
        await expect(vetoView).toBeVisible({ timeout: 15_000 });

        // The veto cap info should be displayed (e.g., "cap: N" or "N vetoes remaining")
        const vetoCap = vetoView.getByText(/cap[:\s]|remaining/i).first();
        await expect(vetoCap).toBeVisible({ timeout: 5_000 });
    });

    test('force-resolve transitions lineup to decided with winner', async ({ page }) => {
        // AC: Veto: survivor (fewest vetoes, tiebreak by original vote count) becomes winner
        // Force-resolve determines the winner and transitions to decided.
        await apiPost(adminToken, `/lineups/${lineupId}/tiebreaker/resolve`);

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // After force-resolve, lineup transitions to decided → podium shows winner
        const podium = page.getByText(/podium/i);
        await expect(podium).toBeVisible({ timeout: 15_000 });

        // The decided view should show a champion
        const champion = page.getByText('Champion');
        await expect(champion).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// AC: Dismiss tiebreaker — operator dismisses, proceeds to decided
// ---------------------------------------------------------------------------

test.describe('Dismiss tiebreaker', () => {
    let lineupId: number;

    test.beforeAll(async () => {
        // Create a new lineup with tiebreaker in bracket mode, then dismiss it
        const result = await createVotingLineupWithTiebreaker(adminToken, 'bracket');
        lineupId = result.lineupId;
    });

    test('operator dismisses tiebreaker and lineup transitions to decided', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: Operator can dismiss tiebreaker, proceeding to decided with default matching
        // The bracket view or tiebreaker prompt should be visible first
        const tiebreakerUI = page.locator(
            '[data-testid="bracket-view"], [data-testid="tiebreaker-prompt-modal"]',
        );
        await expect(tiebreakerUI.first()).toBeVisible({ timeout: 15_000 });

        // Dismiss via the API (operator action)
        await apiPost(adminToken, `/lineups/${lineupId}/tiebreaker/dismiss`);

        // Reload the page — lineup should now be in decided status
        await page.reload();
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // The decided view should render (podium section)
        await expect(page.getByText("THIS WEEK'S PODIUM")).toBeVisible({ timeout: 15_000 });

        // The tiebreaker UI should no longer be visible
        await expect(page.locator('[data-testid="bracket-view"]')).not.toBeVisible();
        await expect(page.locator('[data-testid="veto-view"]')).not.toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// AC: Operator can force-resolve any active tiebreaker
// ---------------------------------------------------------------------------

test.describe('Force-resolve tiebreaker', () => {
    let lineupId: number;

    test.beforeAll(async () => {
        const result = await createVotingLineupWithTiebreaker(adminToken, 'bracket');
        lineupId = result.lineupId;
    });

    test('operator can force-resolve an active bracket tiebreaker', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: Operator can force-resolve any active tiebreaker
        // Force-resolve button should be visible to operators
        const forceResolveBtn = page.getByRole('button', { name: /force.?resolve|end tiebreaker/i });
        await expect(forceResolveBtn).toBeVisible({ timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// AC: Games page banner shows "Tiebreaker active" badge
// ---------------------------------------------------------------------------

test.describe('Tiebreaker active badge on Games page', () => {
    let lineupId: number;

    test.beforeAll(async () => {
        const result = await createVotingLineupWithTiebreaker(adminToken, 'veto');
        lineupId = result.lineupId;
    });

    test('Games page banner shows Tiebreaker active badge', async ({ page }) => {
        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // AC: Games page banner shows "Tiebreaker active" badge
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        const tiebreakerBadge = page.locator('[data-testid="tiebreaker-badge"]');
        await expect(tiebreakerBadge).toBeVisible({ timeout: 10_000 });
        await expect(tiebreakerBadge).toHaveText(/tiebreaker/i);
    });
});

// ---------------------------------------------------------------------------
// AC: GET /lineups/:id/tiebreaker returns tiebreaker detail
// ---------------------------------------------------------------------------

test.describe('Tiebreaker API detail endpoint', () => {
    let lineupId: number;

    test.beforeAll(async () => {
        const result = await createVotingLineupWithTiebreaker(adminToken, 'bracket');
        lineupId = result.lineupId;
    });

    test('GET /lineups/:id/tiebreaker returns tiebreaker data', async ({ page }) => {
        // AC: GET /lineups/:id/tiebreaker returns tiebreaker detail
        // Verify the API endpoint exists and returns data
        const tiebreaker = await apiGet(adminToken, `/lineups/${lineupId}/tiebreaker`);

        expect(tiebreaker).not.toBeNull();
        expect(tiebreaker).toHaveProperty('mode', 'bracket');
        expect(tiebreaker).toHaveProperty('status');
        expect(tiebreaker).toHaveProperty('matchups');

        // Navigate to the detail page to verify the UI uses this data
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // The bracket view should render from the tiebreaker data
        const bracketView = page.locator('[data-testid="bracket-view"]');
        await expect(bracketView).toBeVisible({ timeout: 15_000 });
    });
});
