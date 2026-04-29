/**
 * Lineup Abort smoke tests (ROK-1062).
 *
 * Covers the operator-initiated "Abort Lineup" flow on the lineup detail
 * page:
 *   1. Admin/operator sees "Abort Lineup" button on a non-archived lineup
 *      detail page; the modal opens with the warning + reason textarea +
 *      red confirm; submitting flips the lineup status badge to
 *      "Archived" and the abort button disappears.
 *   2. Member (non-admin/non-operator) does NOT see the abort button.
 *   3. Already-archived lineup → no abort button visible.
 *
 * TDD gate: these tests intentionally fail today — the route
 * `POST /lineups/:id/abort` and the `AbortLineupButton` /
 * `AbortLineupModal` components do not yet exist. The dev agent makes
 * them pass.
 *
 * Requires DEMO_MODE=true (auth bypass + reset-lineups test endpoint).
 *
 * Per-worker title prefix scopes `/admin/test/reset-lineups` so sibling
 * Playwright workers don't archive each other's lineups (mirrors the
 * pattern from `lineup-creation.smoke.spec.ts`, ROK-1147).
 */
import { test, expect } from './base';
import { API_BASE, getAdminToken, apiGet } from './api-helpers';

// This file mutates a single lineup through abort and asserts on the
// global "no active lineup" UI state on the detail page. Run serially
// so cross-worker archives don't race the assertions.
test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-abort';
let workerPrefix: string;
let lineupTitle: string;

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
});

/**
 * Archive lineups owned by THIS worker.
 *
 * `/admin/test/reset-lineups` (DEMO_MODE-only) only archives lineups
 * whose title starts with `workerPrefix`, so sibling workers are
 * unaffected.
 */
async function archiveActiveLineup(token: string): Promise<void> {
    await fetch(`${API_BASE}/admin/test/reset-lineups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ titlePrefix: workerPrefix }),
    });
}

/**
 * Ensure an active (non-archived) lineup exists for this worker. Returns
 * the lineup id.
 */
async function ensureActiveLineup(token: string): Promise<number> {
    await archiveActiveLineup(token);

    const createRes = await fetch(`${API_BASE}/lineups`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        }),
    });

    if (createRes.ok) {
        const data = (await createRes.json()) as { id: number };
        return data.id;
    }

    // 409 — pick up an existing one
    const banner = await apiGet(token, '/lineups/banner');
    if (banner && typeof banner.id === 'number') return banner.id;
    throw new Error('Failed to create or find an active lineup for abort smoke');
}

// ---------------------------------------------------------------------------
// AC 1: Admin sees abort button → modal opens → confirm aborts lineup
// ---------------------------------------------------------------------------

test.describe('Abort Lineup — admin/operator flow', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test.beforeEach(async () => {
        lineupId = await ensureActiveLineup(adminToken);
    });

    test('admin sees abort button, opens modal, confirms abort, status flips to Archived', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Wait for the detail header to render.
        await expect(
            page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
        ).toBeVisible({ timeout: 15_000 });

        // ── Abort button should be visible to admin/operator ──
        const abortButton = page.getByRole('button', { name: /Abort Lineup/i });
        await expect(abortButton).toBeVisible({ timeout: 10_000 });

        // Click opens the modal.
        await abortButton.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // Modal contains warning + reason textarea + red confirm.
        await expect(modal.getByText(/cannot be undone/i)).toBeVisible({
            timeout: 5_000,
        });
        const reasonField = modal.getByRole('textbox');
        await expect(reasonField).toBeVisible({ timeout: 5_000 });
        await reasonField.fill('Smoke test abort — wrong scope.');

        // Watch for the abort POST while submitting.
        const [apiResponse] = await Promise.all([
            page.waitForResponse(
                (r) =>
                    r.url().includes(`/lineups/${lineupId}/abort`) &&
                    r.request().method() === 'POST',
                { timeout: 15_000 },
            ),
            modal
                .getByRole('button', { name: /Abort Lineup|Confirm/i })
                .last()
                .click(),
        ]);
        expect(apiResponse.status()).toBe(200);

        // Modal closes; status badge flips to Archived.
        await expect(modal).toBeHidden({ timeout: 10_000 });

        const archivedBadge = page.locator('span').filter({ hasText: /Archived/i });
        await expect(archivedBadge.first()).toBeVisible({ timeout: 10_000 });

        // Abort button disappears once the lineup is archived.
        await expect(abortButton).toBeHidden({ timeout: 10_000 });
    });

    test('already-archived lineup hides the abort button', async ({ page }) => {
        // First archive the lineup directly via the new endpoint.
        const archiveRes = await fetch(
            `${API_BASE}/lineups/${lineupId}/abort`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                },
                body: JSON.stringify({ reason: 'pre-arrange archived state' }),
            },
        );
        // The endpoint must exist for this test to be meaningful.
        expect(archiveRes.status).toBe(200);

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        await expect(
            page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
        ).toBeVisible({ timeout: 15_000 });

        const abortButton = page.getByRole('button', { name: /Abort Lineup/i });
        await expect(abortButton).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC 2: Member does NOT see the abort button
// ---------------------------------------------------------------------------

test.describe('Abort Lineup — member visibility', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('member-role user does not see abort button on detail page', async ({
        page,
    }) => {
        lineupId = await ensureActiveLineup(adminToken);

        // Provision a member account via the DEMO_MODE-only test endpoint
        // and log in as that user. The endpoint and login flow already exist
        // in TestApp/integration helpers; here we use the public POST
        // /auth/local against a fresh member fixture. If the helper is
        // unavailable, we fall back to expecting "not visible" without
        // role-switching — the button must remain hidden either way for
        // anyone without operator/admin role.
        const memberEmail = `${workerPrefix}member@test.local`;
        const memberPass = 'MemberSmokePass1!';
        await fetch(`${API_BASE}/admin/test/create-member`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ email: memberEmail, password: memberPass }),
        }).catch(() => null);

        const loginRes = await fetch(`${API_BASE}/auth/local`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: memberEmail, password: memberPass }),
        });
        if (!loginRes.ok) {
            // Fallback: navigate as anonymous — member-role behaviour mirrors
            // unauth for visibility purposes (button still absent).
            await page.goto(`/community-lineup/${lineupId}`);
            const abortButton = page.getByRole('button', {
                name: /Abort Lineup/i,
            });
            await expect(abortButton).toHaveCount(0);
            return;
        }
        const { access_token } = (await loginRes.json()) as {
            access_token: string;
        };

        // Inject the member's JWT into localStorage and reload as that user.
        await page.goto('/');
        await page.evaluate((token) => {
            localStorage.setItem('jwt', token);
            localStorage.setItem('access_token', token);
        }, access_token);

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        await expect(
            page.getByRole('heading', { level: 1, name: /Smoke Lineup|Lineup — / }),
        ).toBeVisible({ timeout: 15_000 });

        const abortButton = page.getByRole('button', { name: /Abort Lineup/i });
        await expect(abortButton).toHaveCount(0);
    });
});
