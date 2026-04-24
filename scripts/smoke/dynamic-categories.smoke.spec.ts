/**
 * Dynamic discovery categories smoke tests (ROK-567).
 *
 * Validates the end-to-end flow:
 *   admin loads the dynamic-categories panel →
 *   approves / rejects / edits a seeded pending suggestion →
 *   approved non-expired rows render on /games;
 *   rejected + expired rows do NOT render;
 *   feature-flag-off regenerate returns 503;
 *   vectors-not-ready state surfaces an admin banner.
 *
 * A deterministic seed is injected via the demo-only endpoint
 * `POST /admin/test/seed-discovery-categories` so the test does NOT
 * depend on a live LLM.
 *
 * None of these behaviors exist yet — every test MUST fail until the
 * dev agents land Phases A–C.
 */
import { test, expect } from './base';

// This spec mutates the shared discovery_category_suggestions table via the
// DEMO_MODE seed endpoint. Running desktop + mobile workers in parallel
// lets one worker's TRUNCATE race with another worker's seed, which makes
// the admin-panel assertions flaky (the card the test seeded vanishes
// before page.goto returns). Force serial execution across the suite so
// each describe has a stable DB snapshot.
test.describe.configure({ mode: 'serial' });
import {
    API_BASE,
    getAdminToken,
    apiPost,
    apiPatch,
    apiGet,
} from './api-helpers';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

type SeededSuggestion = { id: string; name: string };

const DEFAULT_THEME_VECTOR = [0.8, -0.2, 0.5, 0.3, 0.1, 0.4, 0.0];

/**
 * Seed a deterministic discovery-category suggestion via the DEMO_MODE-only
 * test endpoint. Dev agents add this endpoint per architect correction #2.
 */
async function seedSuggestion(
    token: string,
    opts: {
        name?: string;
        description?: string;
        status?: 'pending' | 'approved' | 'rejected' | 'expired';
        expiresAt?: string | null;
        sortOrder?: number;
        themeVector?: number[];
        candidateGameIds?: number[];
    } = {},
): Promise<SeededSuggestion> {
    const body: Record<string, unknown> = {
        name: opts.name ?? `Smoke Category ${Date.now()}`,
        description:
            opts.description ??
            'Deterministic smoke-test category seeded via demo endpoint.',
        status: opts.status ?? 'pending',
        sortOrder: opts.sortOrder ?? 1000,
        themeVector: opts.themeVector ?? DEFAULT_THEME_VECTOR,
    };
    if (opts.expiresAt !== undefined) body.expiresAt = opts.expiresAt;
    if (opts.candidateGameIds !== undefined) {
        body.candidateGameIds = opts.candidateGameIds;
    }
    const res = await apiPost(
        token,
        '/admin/test/seed-discovery-categories',
        body,
    );
    if (!res || typeof res.id !== 'string') {
        throw new Error(
            `seed-discovery-categories did not return an id: ${JSON.stringify(res)}`,
        );
    }
    return { id: res.id, name: body.name as string };
}

async function setDynamicCategoriesFlag(
    token: string,
    enabled: boolean,
): Promise<void> {
    const res = await fetch(`${API_BASE}/admin/ai/features`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ dynamicCategoriesEnabled: enabled }),
    });
    if (!res.ok) {
        throw new Error(`failed to set dynamic categories flag: ${res.status}`);
    }
}

async function deleteAllDiscoveryCategorySuggestions(
    token: string,
): Promise<void> {
    // Demo-only cleanup endpoint — dev agent wires this up alongside seeding.
    await apiPost(token, '/admin/test/clear-discovery-categories');
}

// ---------------------------------------------------------------------------
// Suite-wide state
// ---------------------------------------------------------------------------

let adminToken: string;

// Extend beforeAll timeout via testInfo.setTimeout so the shared
// getAdminToken helper can ride out a 429 back-off window when smoke runs
// fire in rapid succession against local dev (auth rate limiter is stricter
// than CI's bootstrap path which uses a different admin-password setup).
//
// NOTE: we do NOT truncate the table in beforeEach. Parallel Playwright
// workers share the DB, and a cross-worker TRUNCATE races with another
// worker's seed → tests vanish under their own feet. Tests rely on unique
// seed names (timestamp + random suffix) to avoid collisions instead.
// Only explicit describes that need a clean slate (e.g. vectors-not-ready)
// clear before seeding.
test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    adminToken = await getAdminToken();
    // One-time clear so the approved/rejected/expired tabs are empty at the
    // start of the run (otherwise Smoke-named residue from prior runs lingers).
    await deleteAllDiscoveryCategorySuggestions(adminToken);
    await setDynamicCategoriesFlag(adminToken, true);
});

test.afterAll(async () => {
    // Leave the flag enabled for the next run. We intentionally do NOT
    // TRUNCATE here — two workers (desktop/mobile) may race, and a
    // too-eager afterAll truncate from one worker wipes in-flight test
    // state in the other. beforeAll of the next suite run handles cleanup.
    await setDynamicCategoriesFlag(adminToken, true).catch(() => {});
});

// ---------------------------------------------------------------------------
// AC 1 — Admin approves a seeded pending suggestion → row renders on /games
// (Desktop + mobile both assert this golden path)
// ---------------------------------------------------------------------------

test.describe('Dynamic categories — approve → render on /games', () => {
    test('admin approves a seeded pending suggestion and it appears on /games', async ({
        page,
    }) => {
        const uniqueName = `Smoke Approved ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const seeded = await seedSuggestion(adminToken, {
            name: uniqueName,
            description: 'Seeded for approval-then-render test.',
            status: 'pending',
            sortOrder: 1,
            expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        });

        // Load the admin Dynamic Categories panel.
        await page.goto('/admin/settings/integrations/plugin/ai/ai');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );
        await expect(
            page.getByRole('heading', { name: 'Dynamic Categories' }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // Find the card for our seeded suggestion.
        const card = page.locator('[data-testid="dynamic-category-card"]', {
            hasText: uniqueName,
        });
        await expect(card).toBeVisible({ timeout: 10_000 });

        // Approve it. The card leaves the pending tab (server-side status
        // filter + list invalidation), so don't assert on the card's DOM
        // transition — verify backend state + /games render instead.
        await card.getByRole('button', { name: 'Approve' }).click();
        await expect
            .poll(
                async () => {
                    const list = await apiGet(
                        adminToken,
                        `/admin/discovery-categories?status=approved`,
                    );
                    return (list?.suggestions ?? []).some(
                        (x: { id: string }) => x.id === seeded.id,
                    );
                },
                { timeout: 10_000 },
            )
            .toBe(true);

        // Now the approved row should render on /games.
        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );
        const heading = page
            .getByRole('heading', { name: uniqueName })
            .first();
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeVisible({ timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// AC 2 — Admin rejects a pending suggestion → does NOT render on /games
// ---------------------------------------------------------------------------

test.describe('Dynamic categories — reject path', () => {
    test('rejected suggestion does not render on /games', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'mobile',
            'Backend behavior identical across viewports — desktop-only',
        );

        const uniqueName = `Smoke Rejected ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await seedSuggestion(adminToken, {
            name: uniqueName,
            description: 'Seeded for reject test.',
            status: 'pending',
        });

        await page.goto('/admin/settings/integrations/plugin/ai/ai');
        await expect(
            page.getByRole('heading', { name: 'Dynamic Categories' }).first(),
        ).toBeVisible({ timeout: 15_000 });

        const card = page.locator('[data-testid="dynamic-category-card"]', {
            hasText: uniqueName,
        });
        await expect(card).toBeVisible({ timeout: 10_000 });

        await card.getByRole('button', { name: 'Reject' }).click();

        // Confirm-reject modal may appear; a reason is optional.
        const confirmBtn = page.getByRole('button', { name: /^Confirm$/ });
        if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await confirmBtn.click();
        }

        // Backend truth: suggestion is now rejected.
        await expect
            .poll(
                async () => {
                    const list = await apiGet(
                        adminToken,
                        `/admin/discovery-categories?status=rejected`,
                    );
                    return (list?.suggestions ?? []).some(
                        (x: { name: string }) => x.name === uniqueName,
                    );
                },
                { timeout: 10_000 },
            )
            .toBe(true);

        // /games must not surface a rejected row.
        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );
        const heading = page.getByRole('heading', { name: uniqueName });
        await expect(heading).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC 3 — Admin edits name + description; after approve, edited name renders
// ---------------------------------------------------------------------------

test.describe('Dynamic categories — edit path', () => {
    test('admin edits name + description; edited name renders on /games after approve', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'mobile',
            'Edit modal flow is desktop-primary — covered by vitest for mobile viewports',
        );

        const originalName = `Smoke Original ${Date.now()}`;
        const editedName = `Smoke Edited ${Date.now()}`;
        await seedSuggestion(adminToken, {
            name: originalName,
            description: 'Seeded for edit test.',
            status: 'pending',
            sortOrder: 2,
            expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        });

        await page.goto('/admin/settings/integrations/plugin/ai/ai');
        await expect(
            page.getByRole('heading', { name: 'Dynamic Categories' }).first(),
        ).toBeVisible({ timeout: 15_000 });

        const card = page.locator('[data-testid="dynamic-category-card"]', {
            hasText: originalName,
        });
        await expect(card).toBeVisible({ timeout: 10_000 });

        await card.getByRole('button', { name: 'Edit' }).click();

        const modal = page.locator('[role="dialog"]');
        await expect(
            modal.getByRole('heading', { name: /edit.*category/i }),
        ).toBeVisible({ timeout: 5_000 });

        const nameInput = modal.getByLabel(/^Name$/i);
        await nameInput.fill(editedName);

        const descInput = modal.getByLabel(/^Description$/i);
        await descInput.fill('Edited description for smoke test.');

        await modal.getByRole('button', { name: 'Save' }).click();
        await expect(modal).not.toBeVisible({ timeout: 5_000 });

        // The card should now display the edited name.
        const renamedCard = page.locator(
            '[data-testid="dynamic-category-card"]',
            { hasText: editedName },
        );
        await expect(renamedCard).toBeVisible({ timeout: 10_000 });
        await renamedCard.getByRole('button', { name: 'Approve' }).click();
        // Card leaves the pending tab once approved — verify backend state.
        await expect
            .poll(
                async () => {
                    const list = await apiGet(
                        adminToken,
                        `/admin/discovery-categories?status=approved`,
                    );
                    return (list?.suggestions ?? []).some(
                        (x: { name: string }) => x.name === editedName,
                    );
                },
                { timeout: 10_000 },
            )
            .toBe(true);

        // Edited name renders on /games.
        await page.goto('/games');
        const heading = page
            .getByRole('heading', { name: editedName })
            .first();
        await heading.scrollIntoViewIfNeeded();
        await expect(heading).toBeVisible({ timeout: 15_000 });

        // Original name must NOT render.
        await expect(
            page.getByRole('heading', { name: originalName }),
        ).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC 4 — Expired approved suggestion does NOT render on /games
// ---------------------------------------------------------------------------

test.describe('Dynamic categories — expiry guard', () => {
    test('expired approved row is excluded from /games response', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'mobile',
            'Backend filter behavior identical across viewports',
        );

        const uniqueName = `Smoke Expired ${Date.now()}`;
        await seedSuggestion(adminToken, {
            name: uniqueName,
            description: 'Seeded with a past expires_at.',
            status: 'approved',
            expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
            sortOrder: 3,
        });

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // The expired row must never render.
        await expect(
            page.getByRole('heading', { name: uniqueName }),
        ).toHaveCount(0);

        // Confirm the discover endpoint does not include the expired row either.
        const discover = await apiGet(adminToken, `/games/discover`);
        const rows = (discover?.rows ?? []) as Array<{ name?: string }>;
        expect(rows.some((r) => r.name === uniqueName)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// AC 5 — Feature flag OFF → POST /admin/discovery-categories/regenerate → 503
// ---------------------------------------------------------------------------

test.describe('Dynamic categories — feature flag gate', () => {
    test('regenerate returns 503 when ai_dynamic_categories_enabled is false', async ({}, testInfo) => {
        test.skip(
            testInfo.project.name === 'mobile',
            'API-level behavior — desktop project runs only',
        );

        await setDynamicCategoriesFlag(adminToken, false);
        try {
            const res = await fetch(
                `${API_BASE}/admin/discovery-categories/regenerate`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${adminToken}`,
                    },
                },
            );
            expect(res.status).toBe(503);
        } finally {
            await setDynamicCategoriesFlag(adminToken, true);
        }
    });
});

// ---------------------------------------------------------------------------
// AC 6 — Vectors-not-ready banner shows when game_taste_vectors is empty
// ---------------------------------------------------------------------------

test.describe('Dynamic categories — vectors-not-ready banner', () => {
    test('admin panel shows the vectors-not-ready banner when every pending suggestion has no candidate games', async ({
        page,
    }, testInfo) => {
        test.skip(
            testInfo.project.name === 'mobile',
            'Banner DOM identical across viewports — desktop verifies',
        );

        // The panel's vectors-not-ready banner fires when EVERY pending
        // suggestion has empty candidateGameIds — same signal the weekly cron
        // emits when game_taste_vectors is empty. Clear first so prior tests'
        // pending rows (with candidates) don't mask the banner.
        await deleteAllDiscoveryCategorySuggestions(adminToken);
        await seedSuggestion(adminToken, {
            name: `Smoke Vectors Not Ready ${Date.now()}`,
            status: 'pending',
            candidateGameIds: [],
        });

        await page.goto('/admin/settings/integrations/plugin/ai/ai');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        await expect(
            page.getByRole('heading', { name: 'Dynamic Categories' }).first(),
        ).toBeVisible({ timeout: 15_000 });

        const banner = page.locator(
            '[data-testid="dynamic-categories-vectors-not-ready"]',
        );
        await expect(banner).toBeVisible({ timeout: 10_000 });
        await expect(banner).toContainText(
            /game taste vectors.*(computing|not ready|populated)/i,
        );
    });
});
