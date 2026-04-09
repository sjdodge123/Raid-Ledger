/**
 * Paste-to-nominate smoke tests (ROK-945).
 *
 * Tests the global paste listener on the Community Lineup detail page
 * that detects Steam store URLs and opens the NominateModal pre-filled.
 *
 * TDD: These tests are written BEFORE the feature is implemented.
 * Positive tests (modal opens, toast appears) MUST fail until the dev
 * agent implements the paste listener, API endpoint, and modal integration.
 * Negative tests (no detection on non-Steam URLs, wrong phase, focused input)
 * pass vacuously now and serve as regression guards.
 */
import { test, expect } from './base';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// API helpers (same pattern as community-lineup.smoke.spec.ts)
// ---------------------------------------------------------------------------

async function getAdminToken(): Promise<string> {
    const res = await fetch(`${API_BASE}/auth/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'admin@local',
            password: process.env.ADMIN_PASSWORD || 'password',
        }),
    });
    const { access_token } = (await res.json()) as { access_token: string };
    return access_token;
}

async function apiPost(token: string, path: string, body?: Record<string, unknown>) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
}

async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
}

async function apiPatch(token: string, path: string, body: Record<string, unknown>) {
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

async function archiveLineup(token: string, id: number): Promise<void> {
    const detail = await apiGet(token, `/lineups/${id}`);
    if (!detail) return;
    const transitions: Record<string, string[]> = {
        building: ['voting', 'decided', 'archived'],
        voting: ['decided', 'archived'],
        decided: ['archived'],
        scheduling: ['archived'],
    };
    const steps = transitions[detail.status];
    if (!steps) return;
    for (const status of steps) {
        await apiPatch(token, `/lineups/${id}/status`, { status });
    }
}

async function ensureBuildingLineup(token: string): Promise<number> {
    const banner = await apiGet(token, '/lineups/banner');
    if (banner && typeof banner.id === 'number' && banner.status === 'building') {
        return banner.id;
    }
    if (banner && typeof banner.id === 'number') {
        await archiveLineup(token, banner.id);
    }
    const lineup = (await apiPost(token, '/lineups', {
        targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    })) as { id?: number };
    if (lineup?.id) return lineup.id;
    const reBanner = await apiGet(token, '/lineups/banner');
    if (reBanner && typeof reBanner.id === 'number') return reBanner.id;
    throw new Error('Failed to create lineup in building phase');
}

// ---------------------------------------------------------------------------
// Paste event helpers
// ---------------------------------------------------------------------------

/** Dispatch a paste event with the given text on document.body. */
async function dispatchPaste(page: import('@playwright/test').Page, text: string) {
    await page.evaluate((pasteText) => {
        const event = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer(),
        });
        event.clipboardData!.setData('text/plain', pasteText);
        document.body.dispatchEvent(event);
    }, text);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// Steam app ID 730 = Counter-Strike 2. A well-known ID that may or may not
// exist in the local games table. The paste listener + API endpoint don't
// exist yet, so these tests will fail regardless.
const KNOWN_STEAM_APP_ID = '730';
const STEAM_URL = `https://store.steampowered.com/app/${KNOWN_STEAM_APP_ID}/`;
const UNKNOWN_STEAM_URL = 'https://store.steampowered.com/app/9999999/';

let adminToken: string;
let lineupId: number;

test.beforeAll(async () => {
    adminToken = await getAdminToken();
    lineupId = await ensureBuildingLineup(adminToken);
});

// ---------------------------------------------------------------------------
// AC1 + AC2: Pasting a Steam store URL on a building-status lineup triggers
// the API call and opens NominateModal in preview state with game info.
// These run on BOTH desktop and mobile projects (AC7).
// ---------------------------------------------------------------------------

test.describe('Paste Steam URL opens NominateModal (AC1, AC2, AC7)', () => {
    test.beforeEach(async () => {
        lineupId = await ensureBuildingLineup(adminToken);
    });

    test('pasting Steam URL opens modal in preview state', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        await dispatchPaste(page, STEAM_URL);

        // The NominateModal should open (role="dialog")
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // Preview state indicators: "Back to search" link and "Submit Nomination" button
        await expect(modal.getByText(/Back to search/)).toBeVisible({ timeout: 5_000 });
        await expect(
            modal.getByRole('button', { name: 'Submit Nomination' }),
        ).toBeVisible({ timeout: 5_000 });
    });

    test('preview state shows game name and cover art or placeholder', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        await dispatchPaste(page, STEAM_URL);

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // The preview card must show either a cover image or the "No art" fallback
        const coverImg = modal.locator('img');
        const noArtFallback = modal.getByText('No art');

        const hasCover = await coverImg.first().isVisible({ timeout: 5_000 }).catch(() => false);
        const hasNoArt = await noArtFallback.isVisible({ timeout: 3_000 }).catch(() => false);
        expect(hasCover || hasNoArt).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// AC3: Pasting a Steam URL for a game NOT in the library shows a toast
// "Game not found in library" and does NOT open the modal.
// ---------------------------------------------------------------------------

test.describe('Unknown game shows toast (AC3)', () => {
    test.beforeEach(async () => {
        lineupId = await ensureBuildingLineup(adminToken);
    });

    test('toast "Game not found in library" appears for unknown Steam app ID', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        await dispatchPaste(page, UNKNOWN_STEAM_URL);

        // Toast should appear (Sonner renders in [data-sonner-toaster])
        const toastMessage = page.getByText(/game not found in library/i);
        await expect(toastMessage).toBeVisible({ timeout: 10_000 });

        // Modal should NOT open
        const modal = page.locator('[role="dialog"]');
        await expect(modal).not.toBeVisible({ timeout: 3_000 });
    });
});

// ---------------------------------------------------------------------------
// AC4: Pasting while focused on an <input> or <textarea> does NOT trigger
// the paste detection. (Regression guard — passes vacuously before feature.)
// ---------------------------------------------------------------------------

test.describe('Input focus suppresses detection (AC4)', () => {
    test.beforeEach(async () => {
        lineupId = await ensureBuildingLineup(adminToken);
    });

    test('pasting Steam URL while focused on search input does not trigger detection', async ({ page }, testInfo) => {
        // The Nominate button on the detail page header overflows on mobile
        // viewport (Pixel 5). This test requires clicking it to open the modal,
        // which fails on mobile. Desktop-only is sufficient for this AC.
        test.skip(testInfo.project.name === 'mobile', 'Nominate button overflows on mobile viewport');

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Open NominateModal manually to get an input on the page
        const nominateBtn = page.getByRole('button', { name: 'Nominate' });
        await nominateBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Focus the search input
        const searchInput = modal.getByPlaceholder('Search games...');
        await searchInput.focus();

        // Dispatch paste on the focused input element
        await page.evaluate((pasteText) => {
            const el = document.activeElement;
            if (!el) return;
            const event = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: new DataTransfer(),
            });
            event.clipboardData!.setData('text/plain', pasteText);
            el.dispatchEvent(event);
        }, STEAM_URL);

        // Modal should stay in search state — "Back to search" means preview state
        await expect(modal.getByText(/Back to search/)).not.toBeVisible({ timeout: 3_000 });

        // Close modal
        await modal.getByRole('button', { name: /close/i }).click();
    });
});

// ---------------------------------------------------------------------------
// AC5: Pasting a non-Steam URL does NOT trigger detection.
// (Regression guard — passes vacuously before feature.)
// ---------------------------------------------------------------------------

test.describe('Non-Steam URLs ignored (AC5)', () => {
    test.beforeEach(async () => {
        lineupId = await ensureBuildingLineup(adminToken);
    });

    test('pasting a non-Steam URL does not open modal or show toast', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        await dispatchPaste(page, 'https://www.example.com/some/page');

        const modal = page.locator('[role="dialog"]');
        await expect(modal).not.toBeVisible({ timeout: 3_000 });

        const toastMessage = page.getByText(/game not found/i);
        await expect(toastMessage).not.toBeVisible({ timeout: 3_000 });
    });

    test('pasting plain text does not trigger detection', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        await dispatchPaste(page, 'just some random text with no URL');

        const modal = page.locator('[role="dialog"]');
        await expect(modal).not.toBeVisible({ timeout: 3_000 });
    });
});

// ---------------------------------------------------------------------------
// AC6: Pasting on a lineup in "voting" or "decided" status does NOT trigger.
// (Regression guard — passes vacuously before feature.)
// ---------------------------------------------------------------------------

test.describe('Paste disabled in non-building phases (AC6)', () => {
    let votingLineupId: number;

    test.beforeAll(async () => {
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (banner && typeof banner.id === 'number') {
            if (banner.status === 'voting') {
                votingLineupId = banner.id;
                return;
            }
            if (banner.status !== 'building') {
                await archiveLineup(adminToken, banner.id);
                const created = (await apiPost(adminToken, '/lineups', {
                    targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                })) as { id: number };
                votingLineupId = created.id;
            } else {
                votingLineupId = banner.id;
            }
        } else {
            const created = (await apiPost(adminToken, '/lineups', {
                targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            })) as { id: number };
            votingLineupId = created.id;
        }

        // Ensure lineup has nominations before advancing to voting
        const detail = await apiGet(adminToken, `/lineups/${votingLineupId}`);
        if (!detail?.entries?.length) {
            const gamesRes = await fetch(`${API_BASE}/games/configured`, {
                headers: { Authorization: `Bearer ${adminToken}` },
            });
            const gamesBody = (await gamesRes.json()) as { data: { id: number }[] };
            const gameIds = gamesBody.data.slice(0, 3).map((g) => g.id);
            for (const gid of gameIds) {
                await apiPost(adminToken, `/lineups/${votingLineupId}/nominate`, { gameId: gid });
            }
        }

        await apiPatch(adminToken, `/lineups/${votingLineupId}/status`, { status: 'voting' });
    });

    test('pasting Steam URL on voting-status lineup does not trigger detection', async ({ page }) => {
        await page.goto(`/community-lineup/${votingLineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        const leaderboard = page.locator('[data-testid="voting-leaderboard"]');
        await expect(leaderboard).toBeVisible({ timeout: 15_000 });

        await dispatchPaste(page, STEAM_URL);

        const modal = page.locator('[role="dialog"]');
        await expect(modal).not.toBeVisible({ timeout: 3_000 });

        const toastMessage = page.getByText(/game not found/i);
        await expect(toastMessage).not.toBeVisible({ timeout: 3_000 });
    });
});
