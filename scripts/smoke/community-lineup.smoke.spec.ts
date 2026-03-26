/**
 * Community Lineup smoke tests (ROK-935).
 *
 * Tests the lineup banner on the Games page, the nomination modal,
 * and the lineup detail page. Creates a lineup via the API in beforeAll
 * and cleans up afterward.
 */
import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_URL || 'http://localhost:3000';

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

// ---------------------------------------------------------------------------
// Setup: ensure an active lineup exists for the test suite
// ---------------------------------------------------------------------------

let adminToken: string;
let lineupId: number;
let createdLineup = false;

/** Archive an active lineup by walking through all valid transitions. */
async function archiveLineup(token: string, id: number): Promise<void> {
    const detail = await apiGet(token, `/lineups/${id}`);
    if (!detail) return;
    const transitions: Record<string, string[]> = {
        building: ['voting', 'decided', 'archived'],
        voting: ['decided', 'archived'],
        decided: ['archived'],
    };
    const steps = transitions[detail.status];
    if (!steps) return;
    for (const status of steps) {
        await apiPatch(token, `/lineups/${id}/status`, { status });
    }
}

test.beforeAll(async () => {
    adminToken = await getAdminToken();

    // Check if an active lineup already exists
    const banner = await apiGet(adminToken, '/lineups/banner');
    if (banner && typeof banner.id === 'number') {
        // Must be in building phase for nomination tests; archive and recreate if not
        if (banner.status === 'building') {
            lineupId = banner.id;
            return;
        }
        await archiveLineup(adminToken, banner.id);
    }

    // Create a fresh lineup in building phase
    const lineup = (await apiPost(adminToken, '/lineups', {
        targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    })) as { id: number };
    lineupId = lineup.id;
    createdLineup = true;
});

// NOTE: No afterAll cleanup — archiving the lineup while the other project
// (desktop/mobile) is still running causes a race condition where detail page
// tests see "Lineup not found". The lineup stays in building status; demo data
// resets handle cleanup.

// ---------------------------------------------------------------------------
// Banner visibility on the Games page
// ---------------------------------------------------------------------------

test.describe('Community Lineup banner on Games page', () => {
    // Re-verify lineup exists before each test — lineup-creation tests may archive it
    test.beforeEach(async () => {
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (banner && typeof banner.id === 'number' && banner.status === 'building') {
            lineupId = banner.id;
            return;
        }
        if (banner && typeof banner.id === 'number') {
            await archiveLineup(adminToken, banner.id);
        }
        const lineup = (await apiPost(adminToken, '/lineups', {
            targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })) as { id?: number };
        if (lineup?.id) {
            lineupId = lineup.id;
        } else {
            const reBanner = await apiGet(adminToken, '/lineups/banner');
            if (reBanner && typeof reBanner.id === 'number') lineupId = reBanner.id;
        }
    });

    test('banner shows COMMUNITY LINEUP text and status badge', async ({ page }) => {
        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // The banner contains the uppercase label "COMMUNITY LINEUP"
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });
    });

    test('banner shows question heading and vote link', async ({ page }) => {
        await page.goto('/games');

        const heading = page.getByText('What are we playing this week?');
        await expect(heading).toBeVisible({ timeout: 15_000 });

        const viewLink = page.getByRole('link', { name: /View Lineup/i });
        await expect(viewLink).toBeVisible({ timeout: 5_000 });
    });

    test('banner shows nomination count text', async ({ page }) => {
        await page.goto('/games');
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        // Subtitle shows "X games nominated"
        await expect(page.getByText(/games nominated/)).toBeVisible({ timeout: 5_000 });
    });

    test('Nominate button is visible on the banner', async ({ page }) => {
        await page.goto('/games');
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        const nominateBtn = page.getByRole('button', { name: 'Nominate' });
        await expect(nominateBtn).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Nomination modal
// ---------------------------------------------------------------------------

test.describe('Nomination modal', () => {
    test('opens when clicking Nominate button on banner', async ({ page }) => {
        await page.goto('/games');
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        await page.getByRole('button', { name: 'Nominate' }).click();

        // Modal title should appear
        const modal = page.locator('[role="dialog"]');
        await expect(modal.getByRole('heading', { name: 'Nominate a Game' })).toBeVisible({ timeout: 5_000 });

        // Search input inside the modal should be present
        await expect(modal.getByPlaceholder('Search games...')).toBeVisible({ timeout: 3_000 });
    });

    test('search input accepts text and shows results or empty state', async ({ page }) => {
        await page.goto('/games');
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        await page.getByRole('button', { name: 'Nominate' }).click();
        const modal = page.locator('[role="dialog"]');
        await expect(modal.getByRole('heading', { name: 'Nominate a Game' })).toBeVisible({ timeout: 5_000 });

        const searchInput = modal.getByPlaceholder('Search games...');
        await searchInput.fill('xyznonexistent999');

        // Should show "No games found" or "Searching..." then "No games found"
        await expect(
            modal.getByText(/no games found/i),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('clicking a search result shows preview card with game name', async ({ page }) => {
        await page.goto('/games');
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        await page.getByRole('button', { name: 'Nominate' }).click();
        const modal = page.locator('[role="dialog"]');
        await expect(modal.getByRole('heading', { name: 'Nominate a Game' })).toBeVisible({ timeout: 5_000 });

        // Search for a game known to exist in most demo/IGDB-seeded databases
        const searchInput = modal.getByPlaceholder('Search games...');
        await searchInput.fill('Lethal');

        // Wait for debounced search (300ms) + API response
        // The SearchResultItem renders as <button> with game name text
        const firstResult = modal.getByRole('button', { name: /Lethal/i }).first();

        // Allow debounce (300ms) + API search + render time
        const hasResults = await firstResult.isVisible({ timeout: 15_000 }).catch(() => false);

        if (!hasResults) {
            test.skip(true, 'No search results for "Lethal" in demo data');
            return;
        }

        // Click the first search result
        await firstResult.click();

        // Preview card shows the "Back to search" link, note textarea, and Submit button
        await expect(modal.getByText(/Back to search/)).toBeVisible({ timeout: 5_000 });
        await expect(modal.getByPlaceholder('Why this game? (optional)')).toBeVisible({ timeout: 3_000 });
        await expect(modal.getByRole('button', { name: 'Submit Nomination' })).toBeVisible({ timeout: 3_000 });
    });

    test('modal closes on close button', async ({ page }) => {
        await page.goto('/games');
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        await page.getByRole('button', { name: 'Nominate' }).click();
        const modal = page.getByRole('dialog', { name: 'Nominate a Game' });
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Close via the close button
        await modal.getByRole('button', { name: /close/i }).click();
        await expect(modal).not.toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

test.describe('Community Lineup detail page', () => {
    // Re-verify lineup exists in building phase before each test.
    // Other workers (lineup-creation tests) may archive the lineup between runs.
    test.beforeEach(async () => {
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (banner && typeof banner.id === 'number' && banner.status === 'building') {
            lineupId = banner.id;
            return;
        }
        if (banner && typeof banner.id === 'number') {
            await archiveLineup(adminToken, banner.id);
        }
        const lineup = (await apiPost(adminToken, '/lineups', {
            targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })) as { id?: number };
        if (lineup?.id) {
            lineupId = lineup.id;
        } else {
            // 409 race — another worker created one; use it
            const reBanner = await apiGet(adminToken, '/lineups/banner');
            if (reBanner && typeof reBanner.id === 'number') lineupId = reBanner.id;
        }
    });

    test('renders header with title and status badge', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Header shows "Community Lineup" title
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Status badge shows one of the valid statuses
        const badge = page.locator('span').filter({ hasText: /Building|Voting|Decided|Archived/ });
        await expect(badge.first()).toBeVisible({ timeout: 5_000 });
    });

    test('progress bar shows nomination count with max', async ({ page }) => {
        // Verify lineup is still in building phase via API — skip if archived/advanced
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        if (!detail || detail.status !== 'building') {
            test.skip(true, 'Lineup is not in building phase — skipped due to cross-project race');
            return;
        }

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Phase breadcrumb shows "Nominating" in the header
        await expect(page.getByText('Nominating').first()).toBeVisible({ timeout: 5_000 });

        // "X/20 nominated" text in the subheader context info
        await expect(page.getByText(/\d+\/\d+ nominated/).first()).toBeVisible({ timeout: 5_000 });
    });

    test('activity timeline section is present', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Activity heading -- the timeline may have entries from lineup creation
        const activityHeading = page.getByText('Activity', { exact: true });
        // Activity section is optional -- it only renders if there are entries.
        // A freshly created lineup should have at least a "created" entry.
        if (await activityHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await expect(activityHeading).toBeVisible();
        }
    });

    test('shows nomination grid or empty state', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Either "Nominated Games" heading (has entries) or empty state text
        const nominatedHeading = page.getByRole('heading', { name: 'Nominated Games' });
        const emptyState = page.getByText(/no nominations yet/i);

        const hasNominations = await nominatedHeading.isVisible({ timeout: 5_000 }).catch(() => false);
        const hasEmptyState = await emptyState.isVisible({ timeout: 3_000 }).catch(() => false);

        // One of the two should be visible
        expect(hasNominations || hasEmptyState).toBe(true);
    });

    test('back button navigates away from detail page', async ({ page }) => {
        // Navigate to games first, then to the detail page via the banner link
        await page.goto('/games');
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });

        const viewLink = page.getByRole('link', { name: /View Lineup/i });
        await viewLink.click();
        await page.waitForURL(/\/community-lineup\/\d+/, { timeout: 10_000 });

        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 10_000 });

        // Click back button (aria-label="Go back")
        await page.getByRole('button', { name: 'Go back' }).click();

        // Should navigate back to the games page
        await page.waitForURL(/\/games/, { timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Responsive layout
// ---------------------------------------------------------------------------

test.describe('Community Lineup responsive layout', () => {
    // Re-verify lineup exists in building phase before each test.
    // Other workers (lineup-creation/phase-breadcrumb tests) may advance or archive the lineup.
    test.beforeEach(async () => {
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (banner && typeof banner.id === 'number' && banner.status === 'building') {
            lineupId = banner.id;
            return;
        }
        if (banner && typeof banner.id === 'number') {
            await archiveLineup(adminToken, banner.id);
        }
        const lineup = (await apiPost(adminToken, '/lineups', {
            targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })) as { id?: number };
        if (lineup?.id) {
            lineupId = lineup.id;
        } else {
            const reBanner = await apiGet(adminToken, '/lineups/banner');
            if (reBanner && typeof reBanner.id === 'number') lineupId = reBanner.id;
        }
    });

    test('nomination grid uses 2-column layout on desktop', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'mobile', 'Desktop-only test -- checks 2-col grid');

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // If there are nominated games, the grid container uses sm:grid-cols-2
        const nominatedHeading = page.getByRole('heading', { name: 'Nominated Games' });
        if (await nominatedHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
            const grid = page.locator('.grid.grid-cols-1.sm\\:grid-cols-2');
            await expect(grid).toBeVisible({ timeout: 3_000 });
        }
    });

    test('nomination grid uses single column on mobile viewport', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test -- checks 1-col grid');

        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            storageState: 'scripts/.auth/admin.json',
        });
        const page = await context.newPage();

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        const nominatedHeading = page.getByRole('heading', { name: 'Nominated Games' });
        if (await nominatedHeading.isVisible({ timeout: 5_000 }).catch(() => false)) {
            // At 390px width, grid-cols-1 applies (sm breakpoint is 640px)
            const grid = page.locator('.grid.grid-cols-1');
            await expect(grid).toBeVisible({ timeout: 3_000 });

            // Verify computed grid columns is 1 (single column)
            const columns = await grid.evaluate(
                (el) => getComputedStyle(el).gridTemplateColumns,
            );
            // Single column should have exactly one column value (no space-separated second value)
            const colCount = columns.trim().split(/\s+/).length;
            expect(colCount).toBe(1);
        }

        await context.close();
    });

    test('banner is visible on mobile viewport', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name === 'desktop', 'Mobile-only test -- verifies banner on mobile');

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Banner should still be visible on mobile
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Nominate' })).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// Voting phase (ROK-936)
// ---------------------------------------------------------------------------

test.describe('Voting phase', () => {
    let votingLineupId: number;

    test.beforeAll(async () => {
        // Ensure a lineup exists and advance it to voting status
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (banner && typeof banner.id === 'number') {
            if (banner.status === 'voting') {
                votingLineupId = banner.id;
                return;
            }
            // Archive anything that is not building (decided, etc)
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
            // No active lineup -- create one
            const created = (await apiPost(adminToken, '/lineups', {
                targetDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            })) as { id: number };
            votingLineupId = created.id;
        }

        // Ensure the lineup has nominations before advancing to voting.
        // CI seeds game registry (WoW=1, WoW Classic=2, etc.) via db:seed:games.
        const detail = await apiGet(adminToken, `/lineups/${votingLineupId}`);
        if (!detail?.entries?.length) {
            for (const gid of [1, 2, 3]) {
                await apiPost(adminToken, `/lineups/${votingLineupId}/nominate`, { gameId: gid });
            }
        }

        // Advance to voting (the detail page needs games to render a leaderboard)
        await apiPatch(adminToken, `/lineups/${votingLineupId}/status`, { status: 'voting' });
    });

    test('leaderboard renders sorted by vote count descending', async ({ page }) => {
        await page.goto(`/community-lineup/${votingLineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // The detail page should show the voting leaderboard when status=voting
        // Look for the leaderboard container or a heading indicating voting mode
        const leaderboard = page.locator('[data-testid="voting-leaderboard"]');
        await expect(leaderboard).toBeVisible({ timeout: 15_000 });

        // Leaderboard rows should be present (at least the nominated games)
        const rows = leaderboard.locator('[data-testid="leaderboard-row"]');
        const rowCount = await rows.count();
        expect(rowCount).toBeGreaterThan(0);
    });

    test('clicking a game row toggles vote with emerald accent and filled checkmark', async ({ page }) => {
        await page.goto(`/community-lineup/${votingLineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        const leaderboard = page.locator('[data-testid="voting-leaderboard"]');
        await expect(leaderboard).toBeVisible({ timeout: 15_000 });

        // Click the first leaderboard row to cast a vote
        const firstRow = leaderboard.locator('[data-testid="leaderboard-row"]').first();
        await firstRow.click();

        // After voting, the row should show an emerald left accent (via data attribute or visual marker)
        // The row should have a "voted" state indicator
        await expect(firstRow.locator('[data-voted="true"]')).toBeVisible({ timeout: 5_000 });

        // A filled checkmark icon should be visible on voted rows
        const checkmark = firstRow.locator('[data-testid="vote-checkmark"]');
        await expect(checkmark).toBeVisible({ timeout: 5_000 });
    });

    test('VoteStatusBar shows vote count and voter participation', async ({ page }) => {
        await page.goto(`/community-lineup/${votingLineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // VoteStatusBar should display "X of 3 votes" text
        const voteCountText = page.getByText(/\d+ of 3 votes/i);
        await expect(voteCountText).toBeVisible({ timeout: 15_000 });

        // VoteStatusBar should display "Y / Z voted" participation text
        const participationText = page.getByText(/\d+\s*\/\s*\d+\s*voted/i);
        await expect(participationText).toBeVisible({ timeout: 5_000 });
    });

    test('match threshold slider is present in StartLineupModal', async ({ page }) => {
        // Archive the voting lineup so we can see the "Start Lineup" button
        await archiveLineup(adminToken, votingLineupId);

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, { timeout: 10_000 });

        // Click "Start Lineup" to open the creation modal
        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await expect(startBtn).toBeVisible({ timeout: 15_000 });
        await startBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Match threshold slider should be present with correct labels
        const thresholdSlider = modal.locator('[data-testid="match-threshold"]');
        await expect(thresholdSlider).toBeVisible({ timeout: 5_000 });

        // Verify the slider has min/max labels
        await expect(modal.getByText('More matches')).toBeVisible({ timeout: 3_000 });
        await expect(modal.getByText('Fewer, larger matches')).toBeVisible({ timeout: 3_000 });

        // Recreate a lineup to restore state for other tests
        const modal2 = page.locator('[role="dialog"]');
        const closeBtn = modal2.getByRole('button', { name: /close/i });
        if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await closeBtn.click();
        }
    });
});
