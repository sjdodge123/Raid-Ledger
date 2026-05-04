/**
 * Public Lineup Share smoke tests (ROK-1067).
 *
 * Covers the public, un-authed `/p/lineup/:slug` route:
 *   1. Loads without auth (no login redirect, H1 + status badge + footer).
 *   2. Toggling `public_share_enabled = false` → 404 UI.
 *   3. Decision block visible only when status === 'decided'.
 *
 * TDD gate (Step 2d): these tests intentionally fail today — the SPA
 * route, the public JSON endpoint, and the toggle endpoint don't exist
 * yet. The dev agent (Step 2e) makes them pass.
 *
 * Mandatory: runs under BOTH Playwright projects (desktop + mobile) per
 * CLAUDE.md ROK-935 rule. The describe blocks are project-agnostic —
 * playwright.config.ts handles project fan-out.
 */
import { test, expect } from './base';
import { API_BASE, getAdminToken, apiPost, apiPatch, apiGet } from './api-helpers';

// Each smoke worker mutates a private DB lineup, so run serially within
// the file to avoid cross-test interference. Cross-worker isolation is
// handled by the per-worker title prefix.
test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'public-lineup-share';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Public Share Lineup`;
    adminToken = await getAdminToken();
});

/**
 * Reset this worker's lineups (DEMO_MODE-only endpoint, prefix-scoped
 * so sibling workers' lineups are untouched).
 */
async function resetWorkerLineups(): Promise<void> {
    await apiPost(adminToken, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

/**
 * Create a public lineup with public_share_enabled = true and return
 * its id + slug. The contract change in Phase 1 of the plan makes
 * `publicSlug` a top-level field on the create response.
 */
async function createSharedLineup(
    overrides: Record<string, unknown> = {},
): Promise<{ id: number; publicSlug: string; status: string }> {
    await resetWorkerLineups();
    const body = (await apiPost(adminToken, '/lineups', {
        title: lineupTitle,
        publicShareEnabled: true,
        buildingDurationHours: 720,
        votingDurationHours: 720,
        decidedDurationHours: 720,
        ...overrides,
    })) as { id?: number; publicSlug?: string; status?: string };
    if (!body?.id || !body?.publicSlug) {
        throw new Error(
            `createSharedLineup failed: ${JSON.stringify(body).slice(0, 200)}`,
        );
    }
    return {
        id: body.id,
        publicSlug: body.publicSlug,
        status: body.status ?? 'building',
    };
}

/**
 * Force the lineup to `status='decided'` with a winning game so the public
 * decision block has data to render. The status PATCH requires a
 * `decidedGameId` (otherwise `decision` resolves to null in the public
 * service — pattern from `lineup-auto-advance.smoke.spec.ts:52-53`).
 */
async function forceDecidedStatus(lineupId: number): Promise<void> {
    const games = await apiGet(adminToken, '/admin/settings/games');
    const firstGameId = games?.data?.[0]?.id as number | undefined;
    if (!firstGameId) {
        throw new Error('Demo data missing — need at least 1 configured game');
    }
    await apiPost(adminToken, `/lineups/${lineupId}/nominate`, {
        gameId: firstGameId,
    });
    // Walk the state machine: building → voting → decided. Direct
    // building → decided is rejected (pattern from auto-advance smoke).
    await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
        status: 'voting',
    });
    await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
        status: 'decided',
        decidedGameId: firstGameId,
    });
}

// ---------------------------------------------------------------------------
// AC: Public route loads without auth (no auth cookies, no JWT)
// ---------------------------------------------------------------------------

test.describe('Public lineup share — un-authed access', () => {
    test('renders public page without auth (no login redirect)', async ({
        browser,
    }) => {
        const { publicSlug } = await createSharedLineup();

        // Fresh context — no storageState, no cookies, no admin JWT.
        const ctx = await browser.newContext({ storageState: undefined });
        const page = await ctx.newPage();

        const response = await page.goto(`/p/lineup/${publicSlug}`);
        // Should be a 200 SPA shell (NOT redirected to /login or /auth).
        expect(response?.status()).toBeLessThan(400);
        expect(page.url()).toContain(`/p/lineup/${publicSlug}`);
        expect(page.url()).not.toMatch(/\/(login|auth)/);

        // H1 must show the lineup title.
        await expect(
            page.getByRole('heading', { level: 1, name: new RegExp(lineupTitle, 'i') }),
        ).toBeVisible({ timeout: 15_000 });

        // Status badge must be visible (Building / Voting / Decided / Archived).
        const badge = page
            .locator('[data-testid="public-lineup-status-badge"]')
            .or(
                page
                    .locator('span,div')
                    .filter({ hasText: /Building|Voting|Decided|Archived/ }),
            )
            .first();
        await expect(badge).toBeVisible({ timeout: 5_000 });

        // Footer attribution.
        await expect(page.getByText(/Made with Raid Ledger/i)).toBeVisible({
            timeout: 5_000,
        });

        // Negative: no login form.
        await expect(page.locator('input[type="password"]')).toHaveCount(0);

        // Negative: no main nav, no app chrome (AC: "no layout chrome, no nav").
        await expect(
            page.locator('nav[aria-label="Main navigation"]'),
        ).toHaveCount(0);

        await ctx.close();
    });
});

// ---------------------------------------------------------------------------
// AC: Toggling public_share_enabled = false renders 404 UI
// ---------------------------------------------------------------------------

test.describe('Public lineup share — disabled lineup', () => {
    test('toggling public_share_enabled off renders 404 UI', async ({
        browser,
    }) => {
        const { id, publicSlug } = await createSharedLineup();

        // Toggle the share flag off.
        const patchRes = await fetch(`${API_BASE}/lineups/${id}/public-share`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ enabled: false }),
        });
        // The endpoint must exist and accept the toggle.
        expect(patchRes.status).toBeGreaterThanOrEqual(200);
        expect(patchRes.status).toBeLessThan(300);

        const ctx = await browser.newContext({ storageState: undefined });
        const page = await ctx.newPage();

        await page.goto(`/p/lineup/${publicSlug}`);

        // Either the JSON endpoint hands a 404 OR the SPA renders a 404 UI.
        // We accept either: assert the user sees fallback copy, NOT the
        // lineup title. ("This lineup is no longer available" or similar.)
        const fallback = page
            .getByText(/no longer available|not found|Made with Raid Ledger/i)
            .first();
        await expect(fallback).toBeVisible({ timeout: 15_000 });

        // Negative: lineup title MUST NOT render.
        const heading = page.getByRole('heading', {
            level: 1,
            name: new RegExp(lineupTitle, 'i'),
        });
        await expect(heading).toHaveCount(0);

        await ctx.close();
    });
});

// ---------------------------------------------------------------------------
// AC: Decision block visible only when status='decided'
// ---------------------------------------------------------------------------

test.describe('Public lineup share — decision block conditional', () => {
    test('hides decision block while status=building', async ({ browser }) => {
        const { publicSlug, status } = await createSharedLineup();
        expect(status).toBe('building');

        const ctx = await browser.newContext({ storageState: undefined });
        const page = await ctx.newPage();
        await page.goto(`/p/lineup/${publicSlug}`);

        // Title renders.
        await expect(
            page.getByRole('heading', { level: 1, name: new RegExp(lineupTitle, 'i') }),
        ).toBeVisible({ timeout: 15_000 });

        // Decision block is NOT visible in building phase.
        const decision = page.locator('[data-testid="public-lineup-decision"]');
        await expect(decision).toHaveCount(0);

        await ctx.close();
    });

    test('shows decision block only when status=decided', async ({
        browser,
    }) => {
        const { id, publicSlug } = await createSharedLineup();
        await forceDecidedStatus(id);

        // Confirm the API now reflects status=decided so the test is meaningful.
        const detail = await apiGet(adminToken, `/lineups/${id}`);
        expect(detail?.status).toBe('decided');

        const ctx = await browser.newContext({ storageState: undefined });
        const page = await ctx.newPage();
        await page.goto(`/p/lineup/${publicSlug}`);

        await expect(
            page.getByRole('heading', { level: 1, name: new RegExp(lineupTitle, 'i') }),
        ).toBeVisible({ timeout: 15_000 });

        const decision = page.locator('[data-testid="public-lineup-decision"]');
        await expect(decision).toBeVisible({ timeout: 5_000 });

        await ctx.close();
    });
});
