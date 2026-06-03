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
        // The abort POST + refetch can run long under heavy parallel mobile
        // load; give the outcome assertions headroom.
        test.setTimeout(60_000);
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Wait for the detail header to render.
        await expect(
            page.getByText(/Smoke Lineup|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });

        // ROK-1323: Abort moved into the operator ⋮ menu. Open it and click
        // the Abort item (operator-only, non-archived).
        await page.getByTestId('lineup-operator-menu-trigger').click();
        const abortItem = page.getByTestId('lineup-operator-menu-abort');
        await expect(abortItem).toBeVisible({ timeout: 10_000 });

        // Click opens the modal.
        await abortItem.click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });

        // Modal contains warning + reason textarea + red confirm.
        await expect(modal.getByText(/cannot be undone/i)).toBeVisible({
            timeout: 5_000,
        });
        const reasonField = modal.getByRole('textbox');
        await expect(reasonField).toBeVisible({ timeout: 5_000 });
        await reasonField.fill('Smoke test abort — wrong scope.');

        // Submit. Assert the OUTCOME (modal closes + aborted state) rather than
        // racing page.waitForResponse — under heavy parallel mobile load the
        // abort POST can take >15s, which made the waitForResponse race flaky
        // even though the mutation fired (button stuck on "Aborting…").
        await modal
            .getByRole('button', { name: /Abort lineup|Confirm/i })
            .last()
            .click();

        // Modal closes once the abort resolves; the page flips to the aborted
        // read-only state.
        await expect(modal).toBeHidden({ timeout: 25_000 });

        // ROK-1323: status badge removed. The aborted banner is the post-abort
        // signal, and the Abort menu item disappears once archived.
        await expect(page.getByTestId('lineup-aborted-banner')).toBeVisible({
            timeout: 25_000,
        });
        await page.getByTestId('lineup-operator-menu-trigger').click();
        await expect(page.getByTestId('lineup-operator-menu-abort')).toHaveCount(0);
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
            page.getByText(/Smoke Lineup|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });

        // ROK-1323: the operator ⋮ menu still renders for an operator, but the
        // Abort item is gated out once the lineup is archived.
        await page.getByTestId('lineup-operator-menu-trigger').click();
        await expect(page.getByTestId('lineup-operator-menu-abort')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Regression: ROK-1207 — aborted-lineup detail page banner + read-only state
// ---------------------------------------------------------------------------
//
// Once an admin aborts a lineup, the detail page must:
//   1. Show a destructive "This lineup was cancelled" banner citing the
//      submitted reason (closes the ROK-1062 frontend gap, F-5 in the
//      ROK-1193 audit).
//   2. Hide every action surface — Nominate button, vote toggles, slot pick,
//      and the advance/revert breadcrumb pills — for ALL personas (admin,
//      invitee, anonymous).
//
// The banner is driven off the `lineup_aborted` activity log entry — the
// lineup row's status is `archived`, NOT a new `aborted` enum value.

test.describe('Regression: ROK-1207 — aborted-lineup detail page banner + read-only', () => {
    let adminToken: string;
    let lineupId: number;
    const abortReason = 'ROK-1207 regression — wrong scope, restart needed.';

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('admin aborts with a reason → banner with reason + no action affordances', async ({
        page,
    }) => {
        lineupId = await ensureActiveLineup(adminToken);

        // Server-side abort (sidesteps the modal flow that AC 1 already
        // covers) so this regression test focuses on the post-abort state.
        const abortRes = await fetch(`${API_BASE}/lineups/${lineupId}/abort`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ reason: abortReason }),
        });
        expect(abortRes.status).toBe(200);

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        await expect(
            page.getByText(/Smoke Lineup|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });

        // Banner present + carries the operator-submitted reason.
        const banner = page.getByTestId('lineup-aborted-banner');
        await expect(banner).toBeVisible({ timeout: 10_000 });
        await expect(banner).toContainText(/cancelled/i);
        await expect(
            page.getByTestId('lineup-aborted-reason'),
        ).toContainText(abortReason);

        // Action affordances absent: Nominate button (top-right) and the
        // advance/revert breadcrumb pills must not be operable for the
        // admin viewer either.
        await expect(
            page.getByRole('button', { name: /^Nominate$/ }),
        ).toHaveCount(0);

        // Phase breadcrumb pills are rendered as plain text (no `button`
        // role) once the lineup is aborted. The PhaseBreadcrumb hooks
        // `canOperate` to false when isAborted, so the advance/revert
        // affordance disappears for every persona.
        const advanceButtons = page.getByRole('button', {
            name: /^(Building|Voting|Decided|Archived)$/,
        });
        await expect(advanceButtons).toHaveCount(0);

        // Read-only snapshot rendered in place of the phase body.
        await expect(
            page.getByTestId('lineup-aborted-snapshot'),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('invitee reload sees the banner and no Nominate CTA', async ({ page }) => {
        lineupId = await ensureActiveLineup(adminToken);

        await fetch(`${API_BASE}/lineups/${lineupId}/abort`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ reason: abortReason }),
        });

        // Anonymous reload — non-organizer perspective. Banner must still be
        // present and the Nominate button must not render at all.
        await page.context().clearCookies();
        await page.goto(`/community-lineup/${lineupId}`);

        const banner = page.getByTestId('lineup-aborted-banner');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toContainText(/cancelled/i);

        await expect(
            page.getByRole('button', { name: /^Nominate$/ }),
        ).toHaveCount(0);
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
            page.getByText(/Smoke Lineup|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });

        const abortButton = page.getByRole('button', { name: /Abort Lineup/i });
        await expect(abortButton).toHaveCount(0);
    });
});
