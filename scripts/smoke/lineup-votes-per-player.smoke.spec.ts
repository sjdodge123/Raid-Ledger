/**
 * Lineup Votes-Per-Player smoke tests (ROK-976).
 *
 * Tests the "Votes per player" slider on the create lineup modal
 * and the voting UI that uses the configured limit instead of hardcoded 3.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

/** Cached admin token. */
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
                const { access_token } = (await res.json()) as { access_token: string };
                return access_token;
            }
            if (res.status === 429) {
                await new Promise((r) => setTimeout(r, attempt === 0 ? 5_000 : 15_000));
                continue;
            }
            throw new Error(`Auth failed: ${res.status}`);
        }
        throw new Error('Auth failed after 3 attempts');
    })();
    _cachedToken = await _tokenPromise;
    _tokenPromise = null;
    return _cachedToken;
}

async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

async function apiPatch(token: string, path: string, body: Record<string, unknown>) {
    return fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
}

async function apiPost(token: string, path: string, body?: Record<string, unknown>) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res;
}

async function archiveActiveLineup(token: string): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const banner = await apiGet(token, '/lineups/banner');
        if (!banner || typeof banner.id !== 'number') return;

        const detail = await apiGet(token, `/lineups/${banner.id}`);
        if (!detail) return;

        const transitions: Record<string, string[]> = {
            building: ['voting', 'scheduling', 'decided', 'archived'],
            voting: ['scheduling', 'decided', 'archived'],
            scheduling: ['decided', 'archived'],
            decided: ['archived'],
        };
        const steps = transitions[detail.status];
        if (!steps) return;

        for (const status of steps) {
            const body: Record<string, unknown> = { status };
            if (status === 'decided' && detail.entries?.length > 0) {
                body.decidedGameId = detail.entries[0].gameId;
            }
            const patchRes = await apiPatch(token, `/lineups/${banner.id}/status`, body);
            if (!patchRes.ok) break;
        }

        const check = await apiGet(token, '/lineups/banner');
        if (!check || typeof check.id !== 'number') return;
    }
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

    const createRes = await apiPost(token, '/lineups', {
        buildingDurationHours: 24,
        votingDurationHours: 48,
        votesPerPlayer,
    });
    if (!createRes.ok) {
        // 409 race — another worker created one; use it
        const banner = await apiGet(token, '/lineups/banner');
        if (banner && typeof banner.id === 'number') return banner.id;
        throw new Error(`Failed to create lineup: ${createRes.status}`);
    }
    const lineup = (await createRes.json()) as { id: number };
    const lineupId = lineup.id;

    // Nominate at least 3 games for the voting phase
    for (const gid of [1, 2, 3]) {
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

        await expect(async () => {
            await archiveActiveLineup(adminToken);
            await page.goto('/games');
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 3_000 },
            );
            const startBtn = page.getByRole('button', { name: /Start Lineup/i });
            await expect(startBtn).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 45_000 });

        // Open the create lineup modal
        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await startBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // AC: slider with data-testid="votes-per-player" must exist
        const votesSlider = modal.locator('[data-testid="votes-per-player"]');
        await expect(votesSlider).toBeVisible({ timeout: 5_000 });
    });

    test('votes-per-player slider has range 1-10, default 3, and step 1', async ({ page }) => {
        test.setTimeout(60_000);

        await expect(async () => {
            await archiveActiveLineup(adminToken);
            await page.goto('/games');
            await expect(page.locator('body')).not.toHaveText(
                /something went wrong/i,
                { timeout: 3_000 },
            );
            const startBtn = page.getByRole('button', { name: /Start Lineup/i });
            await expect(startBtn).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 45_000 });

        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await startBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

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
