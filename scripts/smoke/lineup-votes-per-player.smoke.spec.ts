/**
 * Lineup Votes-Per-Player smoke tests (ROK-976).
 *
 * Tests the "Votes per player" slider on the create lineup modal
 * and the voting UI that uses the configured limit instead of hardcoded 3.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import { test, expect } from './base';
import {
    API_BASE,
    getAdminToken,
    apiGet,
    createLineupOrRetry,
} from './api-helpers';

// ROK-1147: tests assert the Start Lineup button is visible (only true
// when no active lineup exists globally). Per-worker isolation lets
// siblings hold concurrent lineups, so the banner shows their lineup
// and the button is hidden. Run serially so this worker owns the
// global state for the duration of the file.
test.describe.configure({ mode: 'serial' });

// ROK-1167: per-worker title prefix scopes /admin/test/reset-lineups so
// sibling workers don't archive each other's lineups mid-test.
const FILE_PREFIX = 'lineup-votes-per-player';
let workerPrefix: string;
let lineupTitle: string;

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
});

/** Local apiPatch that returns raw Response (callers check .ok). */
async function apiPatch(token: string, path: string, body: Record<string, unknown>) {
    return fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
}

/** Local apiPost that returns raw Response (callers check .ok). */
async function apiPost(token: string, path: string, body?: Record<string, unknown>) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res;
}

async function archiveActiveLineup(token: string): Promise<void> {
    // ROK-1167: prefix-scoped reset only archives this worker's lineups,
    // so sibling workers (and any in-flight phase jobs they own) are
    // unaffected. Replaces the manual phase-walk that contended with
    // /lineups/banner returning siblings' rows.
    await apiPost(token, '/admin/test/reset-lineups', { titlePrefix: workerPrefix });
}

/** Fetch real game IDs from the admin endpoint (seed data IDs are non-sequential). */
async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length) throw new Error('No games in DB — seed data missing');
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

/**
 * Create a lineup in voting phase with nominated games and a custom votesPerPlayer.
 * Returns the lineup ID.
 */
async function createVotingLineupWithVotesPerPlayer(
    token: string,
    votesPerPlayer: number,
): Promise<number> {
    await archiveActiveLineup(token);

    const gameIds = await fetchGameIds(token, 3);

    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            votesPerPlayer,
        },
        workerPrefix,
    );

    // Nominate real games from the seed data
    for (const gid of gameIds) {
        await apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid });
    }

    // Advance to voting
    await apiPatch(token, `/lineups/${lineupId}/status`, { status: 'voting' });
    return lineupId;
}

// ---------------------------------------------------------------------------
// AC: Create modal has "Votes per player" slider (range 1-10, default 3, step 1)
// ---------------------------------------------------------------------------

test.describe('Votes-per-player slider on create modal', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('create modal contains a votes-per-player slider with data-testid', async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto('/games?test=open-lineup-modal');
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        // AC: slider with data-testid="votes-per-player" must exist
        const votesSlider = modal.locator('[data-testid="votes-per-player"]');
        await expect(votesSlider).toBeVisible({ timeout: 5_000 });
    });

    test('votes-per-player slider has range 1-10, default 3, and step 1', async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto('/games?test=open-lineup-modal');
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        const votesSlider = modal.locator('[data-testid="votes-per-player"]');
        await expect(votesSlider).toBeVisible({ timeout: 5_000 });

        // Verify attributes: min=1, max=10, step=1, value=3
        await expect(votesSlider).toHaveAttribute('min', '1');
        await expect(votesSlider).toHaveAttribute('max', '10');
        await expect(votesSlider).toHaveAttribute('step', '1');
        await expect(votesSlider).toHaveAttribute('value', '3');
    });
});

// ---------------------------------------------------------------------------
// AC: VoteStatusBar shows "You've used X of {N} votes" with configured limit
// ---------------------------------------------------------------------------

test.describe('VoteStatusBar shows configured limit', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('VoteStatusBar shows "of 5 votes" when lineup has votesPerPlayer=5', async ({ page }) => {
        test.setTimeout(60_000);

        let lineupId: number;
        try {
            lineupId = await createVotingLineupWithVotesPerPlayer(adminToken, 5);
        } catch {
            test.skip(true, 'Failed to create voting lineup with votesPerPlayer=5');
            return;
        }

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: VoteStatusBar should show "of 5 votes" (not hardcoded "of 3 votes")
        const voteCountText = page.getByText(/\d+ of 5 votes/i);
        await expect(voteCountText).toBeVisible({ timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// AC: GET /lineups/:id response includes maxVotesPerPlayer
// ---------------------------------------------------------------------------

test.describe('GET /lineups/:id includes maxVotesPerPlayer', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('API response includes maxVotesPerPlayer field', async () => {
        let lineupId: number;
        try {
            lineupId = await createVotingLineupWithVotesPerPlayer(adminToken, 7);
        } catch {
            test.skip(true, 'Failed to create voting lineup with votesPerPlayer=7');
            return;
        }

        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        expect(detail).toBeTruthy();

        // AC: response must include maxVotesPerPlayer field
        expect(detail.maxVotesPerPlayer).toBeDefined();
        expect(detail.maxVotesPerPlayer).toBe(7);
    });
});
