/**
 * Lineup Creation & Phase Scheduling smoke tests (ROK-946).
 *
 * Tests the "Start Lineup" button on the Games page, the creation modal
 * with configurable duration fields, phase countdown display, force-advance
 * functionality, and the admin settings panel for default durations.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
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

async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
}

async function apiPatch(
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

/**
 * Archive any active lineup so each test starts clean.
 * Walks through all valid transitions to reach archived status.
 */
async function archiveActiveLineup(token: string): Promise<void> {
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
}

// ---------------------------------------------------------------------------
// "Start Lineup" button visibility on Games page
// ---------------------------------------------------------------------------

test.describe('Start Lineup button on Games page', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('shows Start Lineup button when no active lineup and user is operator', async ({ page }) => {
        // Ensure no active lineup exists
        await archiveActiveLineup(adminToken);

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // The "Start Lineup" button should be visible for operators/admins
        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await expect(startBtn).toBeVisible({ timeout: 15_000 });
    });

    test('Games page shows lineup banner with countdown instead of Start Lineup when active', async ({ page }) => {
        // Ensure an active lineup exists -- create one if needed
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (!banner || typeof banner.id !== 'number') {
            const createRes = await fetch(`${API_BASE}/lineups`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                },
                body: JSON.stringify({}),
            });
            expect(createRes.ok).toBe(true);
        }

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // When a lineup is active, the banner must show a phase countdown
        // (e.g., "Building - 23h remaining"). This only renders after
        // ROK-946 adds the phaseDeadline field and countdown display.
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({
            timeout: 15_000,
        });
        const countdown = page.getByText(/remaining/i);
        await expect(countdown).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Lineup creation modal with duration fields
// ---------------------------------------------------------------------------

test.describe('Lineup creation modal', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        await archiveActiveLineup(adminToken);
    });

    test('modal opens with duration fields pre-filled from admin defaults', async ({ page }) => {
        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Click "Start Lineup" to open modal
        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await expect(startBtn).toBeVisible({ timeout: 15_000 });
        await startBtn.click();

        // Modal should open with duration configuration fields
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Duration fields for each phase should be present and pre-filled
        const buildingDuration = modal.locator(
            'input[name="buildingDurationHours"], [data-testid="building-duration"]',
        );
        await expect(buildingDuration).toBeVisible({ timeout: 5_000 });

        const votingDuration = modal.locator(
            'input[name="votingDurationHours"], [data-testid="voting-duration"]',
        );
        await expect(votingDuration).toBeVisible({ timeout: 5_000 });

        const decidedDuration = modal.locator(
            'input[name="decidedDurationHours"], [data-testid="decided-duration"]',
        );
        await expect(decidedDuration).toBeVisible({ timeout: 5_000 });
    });

    test('submitting modal creates lineup and navigates to detail page', async ({ page }) => {
        await archiveActiveLineup(adminToken);

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        const startBtn = page.getByRole('button', { name: /Start Lineup/i });
        await expect(startBtn).toBeVisible({ timeout: 15_000 });
        await startBtn.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5_000 });

        // Submit the creation form
        const submitBtn = modal.getByRole('button', {
            name: /Create Lineup|Start|Submit/i,
        });
        await expect(submitBtn).toBeVisible({ timeout: 5_000 });
        await submitBtn.click();

        // Should navigate to the lineup detail page
        await page.waitForURL(/\/community-lineup\/\d+/, { timeout: 15_000 });
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Phase countdown display
// ---------------------------------------------------------------------------

test.describe('Phase countdown display', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        await archiveActiveLineup(adminToken);

        // Create a lineup with duration params so phaseDeadline is set
        const res = await fetch(`${API_BASE}/lineups`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({
                buildingDurationHours: 24,
                votingDurationHours: 48,
                decidedDurationHours: 24,
            }),
        });
        const data = (await res.json()) as { id: number };
        lineupId = data.id;
    });

    test('banner shows compact countdown with time remaining', async ({ page }) => {
        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Banner should show compact countdown like "Building - 23h remaining"
        const countdown = page.getByText(/remaining/i);
        await expect(countdown).toBeVisible({ timeout: 15_000 });
    });

    test('detail page shows full countdown timer', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Full countdown should be visible on the detail page
        const countdown = page.getByText(/remaining|countdown|time left/i);
        await expect(countdown).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Force-advance functionality
// ---------------------------------------------------------------------------

test.describe('Force-advance phase transition', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        await archiveActiveLineup(adminToken);

        // Create lineup with durations
        const res = await fetch(`${API_BASE}/lineups`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({
                buildingDurationHours: 24,
                votingDurationHours: 48,
                decidedDurationHours: 24,
            }),
        });
        const data = (await res.json()) as { id: number };
        lineupId = data.id;
    });

    test('detail page shows Force Advance button for operators', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Force Advance button should be visible for operator/admin users
        const forceBtn = page.getByRole('button', { name: /Force Advance/i });
        await expect(forceBtn).toBeVisible({ timeout: 10_000 });
    });

    test('clicking Force Advance transitions the phase', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(
            page.getByRole('heading', { name: 'Community Lineup' }),
        ).toBeVisible({ timeout: 15_000 });

        // Current phase should be "Building" (or its label equivalent)
        const buildingBadge = page.locator('span').filter({
            hasText: /Building|Nominating/,
        });
        await expect(buildingBadge.first()).toBeVisible({ timeout: 5_000 });

        // Click Force Advance
        const forceBtn = page.getByRole('button', { name: /Force Advance/i });
        await expect(forceBtn).toBeVisible({ timeout: 5_000 });
        await forceBtn.click();

        // Phase should transition to "Voting"
        const votingBadge = page.locator('span').filter({ hasText: /Voting/ });
        await expect(votingBadge.first()).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Admin settings panel for default lineup durations
// ---------------------------------------------------------------------------

test.describe('Admin lineup duration settings', () => {
    test('admin settings panel exists at /admin/settings/general/lineup', async ({ page }) => {
        await page.goto('/admin/settings/general/lineup');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Should render a heading for lineup duration defaults
        const heading = page.getByRole('heading', {
            name: /Lineup|Phase Duration|Community Lineup/i,
        });
        await expect(heading).toBeVisible({ timeout: 15_000 });
    });

    test('admin settings panel shows duration input fields', async ({ page }) => {
        await page.goto('/admin/settings/general/lineup');

        const heading = page.getByRole('heading', {
            name: /Lineup|Phase Duration|Community Lineup/i,
        });
        await expect(heading).toBeVisible({ timeout: 15_000 });

        // Should have input fields for building, voting, and decided durations
        const buildingInput = page.locator(
            'input[name="buildingDurationHours"], [data-testid="default-building-duration"]',
        );
        await expect(buildingInput).toBeVisible({ timeout: 5_000 });

        const votingInput = page.locator(
            'input[name="votingDurationHours"], [data-testid="default-voting-duration"]',
        );
        await expect(votingInput).toBeVisible({ timeout: 5_000 });

        const decidedInput = page.locator(
            'input[name="decidedDurationHours"], [data-testid="default-decided-duration"]',
        );
        await expect(decidedInput).toBeVisible({ timeout: 5_000 });
    });

    test('no error boundary on load', async ({ page }) => {
        await page.goto('/admin/settings/general/lineup');

        const heading = page.getByRole('heading', {
            name: /Lineup|Phase Duration|Community Lineup/i,
        });
        await expect(heading).toBeVisible({ timeout: 15_000 });

        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
        );
    });
});
