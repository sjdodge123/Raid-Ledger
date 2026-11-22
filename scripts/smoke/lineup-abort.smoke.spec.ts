/**
 * Lineup Abort smoke tests (ROK-1062).
 *
 * Covers the operator-initiated "Abort Lineup" flow on the lineup detail
 * page:
 *   1. Admin/operator sees "Abort Lineup" button on a non-archived lineup
 *      detail page; the modal opens with the warning + reason textarea +
 *      red confirm; submitting flips the lineup status badge to
 *      "Archived" and the abort button disappears.
 *   2. A signed-in member (non-admin/non-operator) sees no abort control,
 *      and `POST /lineups/:id/abort` with their token is refused (403).
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
import { API_BASE, apiGet, getAdminToken, getInviteeFixture, createLineupOrRetry } from './api-helpers';
import { signInContextAs } from './browser-session';

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
 *
 * Always creates OUR OWN lineup. The old 409 fallback adopted whatever
 * `/lineups/banner` returned — a sibling worker's lineup, which that worker
 * could archive mid-test, so `/abort` then 409'd and the modal never closed.
 * `createLineupOrRetry` resets only this worker's prefix and retries (ROK-1070).
 */
async function ensureActiveLineup(token: string): Promise<number> {
    await archiveActiveLineup(token);
    const { id } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        },
        workerPrefix,
    );
    return id;
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

        const abortRes = await fetch(`${API_BASE}/lineups/${lineupId}/abort`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ reason: abortReason }),
        });
        expect(abortRes.status).toBe(200);

        // Non-organizer perspective: re-sign this context in as the member
        // fixture. (The old `clearCookies()` never signed anyone out — the
        // admin token lived in localStorage — and a truly signed-out visitor
        // gets /login here, since the route is behind AuthGuard.) Banner must
        // still be present and the Nominate button must not render at all.
        const invitee = await getInviteeFixture();
        await signInContextAs(page.context(), invitee.userId);
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

    test('signed-in member sees no abort control and the API refuses their abort', async ({
        page,
    }) => {
        lineupId = await ensureActiveLineup(adminToken);

        // Sign this context in as the seeded non-admin fixture member
        // (`seed-fixture-user`, role `member`, pre-onboarded) — a real
        // `rl_rt` session, not a localStorage token the app never reads.
        const member = await getInviteeFixture();
        await signInContextAs(page.context(), member.userId);

        // Prove the page booted AS the member before asserting absences:
        // otherwise a signed-out visit (bounced to /login) passes vacuously.
        const meResponse = page.waitForResponse(
            (r) =>
                r.request().method() === 'GET' &&
                new URL(r.url()).pathname.endsWith('/auth/me'),
            { timeout: 15_000 },
        );
        await page.goto(`/community-lineup/${lineupId}`);
        const me = await meResponse;
        expect(me.status()).toBe(200);
        const meBody = (await me.json()) as { id?: unknown; role?: unknown };
        expect({ id: meBody.id, role: meBody.role }).toEqual({
            id: member.userId,
            role: 'member',
        });

        await expect(page).toHaveURL(new RegExp(`/community-lineup/${lineupId}(?:[?#]|$)`));
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );
        await expect(
            page.getByText(/Smoke Lineup|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });

        // ROK-1323: Abort lives in the operator ⋮ menu, which renders only for
        // operators/admins (or the lineup's creator). The admin test above is
        // the positive control: the same trigger IS visible to an operator.
        await expect(page.getByTestId('lineup-operator-menu-trigger')).toHaveCount(0);
        await expect(page.getByTestId('lineup-operator-menu-abort')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Abort Lineup/i })).toHaveCount(0);

        // Server-side: the member's own token is refused (RolesGuard →
        // 403), and the lineup is left un-archived.
        const abortRes = await fetch(`${API_BASE}/lineups/${lineupId}/abort`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${member.jwt}`,
            },
            body: JSON.stringify({ reason: 'member must not abort' }),
        });
        expect(abortRes.status).toBe(403);
        const after = (await apiGet(adminToken, `/lineups/${lineupId}`)) as {
            status?: unknown;
        } | null;
        expect(after).not.toBeNull();
        expect(after?.status).not.toBe('archived');
    });
});
