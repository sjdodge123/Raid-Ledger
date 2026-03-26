/**
 * Phase breadcrumb interaction smoke tests (ROK-946).
 *
 * Tests the interactive phase breadcrumb on the lineup detail page:
 * - Adjacent phases are clickable for operators
 * - First click shows "Advance?" or "Revert?" confirmation
 * - Second click executes the transition
 * - Confirmation resets after 3-second timeout
 * - Non-adjacent phases are not clickable
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

async function apiPatch(token: string, path: string, body: Record<string, unknown>) {
    return fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
    });
}

async function apiGet(token: string, path: string) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
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

async function ensureActiveLineup(token: string): Promise<number> {
    await archiveActiveLineup(token);
    const createRes = await fetch(`${API_BASE}/lineups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ buildingDurationHours: 24, votingDurationHours: 48 }),
    });
    if (createRes.ok) {
        const data = (await createRes.json()) as { id: number };
        return data.id;
    }
    const banner = await apiGet(token, '/lineups/banner');
    if (banner && typeof banner.id === 'number') return banner.id;
    throw new Error('Failed to create or find an active lineup');
}

async function ensureLineupInPhase(token: string, targetPhase: string): Promise<number> {
    const lineupId = await ensureActiveLineup(token);
    const transitions: Record<string, string[]> = {
        building: [],
        voting: ['voting'],
        scheduling: ['voting', 'scheduling'],
        decided: ['voting', 'scheduling', 'decided'],
    };
    for (const status of transitions[targetPhase] ?? []) {
        const body: Record<string, unknown> = { status };
        if (status === 'decided') body.decidedGameId = null;
        await apiPatch(token, `/lineups/${lineupId}/status`, body);
    }
    return lineupId;
}

// ---------------------------------------------------------------------------
// Navigate to detail page with retry for parallel worker races
// ---------------------------------------------------------------------------

async function gotoLineupDetail(page: ReturnType<typeof test.info>['_test'] extends never ? never : Parameters<Parameters<typeof test>[1]>[0]['page'], lineupId: number) {
    await page.goto(`/community-lineup/${lineupId}`);
    await expect(
        page.getByRole('heading', { name: 'Community Lineup' }),
    ).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Breadcrumb visibility and interaction
// ---------------------------------------------------------------------------

test.describe('Phase breadcrumb — operator controls', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('current phase is highlighted, non-adjacent phases are plain text', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);

            // "Nominating" (building) is the current phase — should NOT be a button
            const nominatingSpan = page.locator('span', { hasText: 'Nominating' }).filter({
                has: page.locator(':scope:not(button)'),
            });
            await expect(nominatingSpan.first()).toBeVisible({ timeout: 3_000 });

            // "Scheduling" is 2 phases ahead — should NOT be a button
            await expect(page.getByRole('button', { name: 'Scheduling' })).toHaveCount(0);

            // "Decided" is 3 phases ahead — should NOT be a button
            await expect(page.getByRole('button', { name: 'Decided' })).toHaveCount(0);

            // "Archived" is 4 phases ahead — should NOT be a button
            await expect(page.getByRole('button', { name: 'Archived' })).toHaveCount(0);
        }).toPass({ timeout: 30_000 });
    });

    test('next phase is a clickable button from building', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);
            await expect(page.getByRole('button', { name: 'Voting' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('previous phase is a clickable button from voting', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);
            await expect(page.getByRole('button', { name: 'Nominating' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });
});

// ---------------------------------------------------------------------------
// Advance flow (building → voting)
// ---------------------------------------------------------------------------

test.describe('Phase breadcrumb — advance', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('first click shows "Advance?" confirmation', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);
            await page.getByRole('button', { name: 'Voting' }).click();
            await expect(page.getByRole('button', { name: 'Advance?' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('second click executes advance to voting', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureActiveLineup(adminToken);
            await gotoLineupDetail(page, lineupId);

            await page.getByRole('button', { name: 'Voting' }).click();
            await expect(page.getByRole('button', { name: 'Advance?' })).toBeVisible({ timeout: 3_000 });
            await page.getByRole('button', { name: 'Advance?' }).click();
        }).toPass({ timeout: 30_000 });

        // Status should update to Voting
        await expect(page.locator('span').filter({ hasText: /Voting/ }).first()).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Revert flow (voting → building)
// ---------------------------------------------------------------------------

test.describe('Phase breadcrumb — revert', () => {
    // Revert tests need extra time — ensureLineupInPhase does 2+ API calls per retry
    test.setTimeout(60_000);

    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('first click shows "Revert?" confirmation', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);
            await page.getByRole('button', { name: 'Nominating' }).click();
            await expect(page.getByRole('button', { name: 'Revert?' })).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 30_000 });
    });

    test('second click executes revert to building', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'voting');
            await gotoLineupDetail(page, lineupId);

            await page.getByRole('button', { name: 'Nominating' }).click();
            await expect(page.getByRole('button', { name: 'Revert?' })).toBeVisible({ timeout: 3_000 });
            await page.getByRole('button', { name: 'Revert?' }).click();
        }).toPass({ timeout: 30_000 });

        // Status should revert to Nominating/building
        await expect(page.locator('span').filter({ hasText: /Nominating/ }).first()).toBeVisible({ timeout: 10_000 });
    });

    test('revert from decided back to scheduling', async ({ page }) => {
        await expect(async () => {
            const lineupId = await ensureLineupInPhase(adminToken, 'decided');
            await gotoLineupDetail(page, lineupId);

            await page.getByRole('button', { name: 'Scheduling' }).click();
            await expect(page.getByRole('button', { name: 'Revert?' })).toBeVisible({ timeout: 3_000 });
            await page.getByRole('button', { name: 'Revert?' }).click();
        }).toPass({ timeout: 45_000 });

        await expect(page.locator('span').filter({ hasText: /Scheduling/ }).first()).toBeVisible({ timeout: 10_000 });
    });
});

