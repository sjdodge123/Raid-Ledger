/**
 * Cancel Poll second-confirm modal smoke tests (ROK-1219 / F-38).
 *
 * Covers the operator-initiated "Cancel Poll" flow on a standalone
 * scheduling poll page (`/community-lineup/:lineupId/schedule/:matchId`):
 *   AC1 — clicking "Cancel Poll" opens a modal with the exact copy
 *         "Cancel this poll? Voters will be notified. This cannot be undone."
 *         and does NOT call the cancel endpoint.
 *   AC2 — the modal has an optional reason textarea (max 500 chars).
 *   AC3 — the modal's own Cancel closes it with NO network call; the poll
 *         page is unchanged.
 *   AC4 (UI) — Confirm with a reason fires the cancel POST and redirects to
 *         /events.
 *
 * TDD gate: these tests intentionally FAIL today — the current
 * `SchedulingCancelAction` fires `cancelPoll.mutate()` directly on click
 * (no modal at all), so:
 *   - the modal copy never appears (AC1 fails),
 *   - clicking "Cancel Poll" DOES hit the endpoint immediately (AC1's
 *     "no network call" assertion fails),
 *   - there is no reason textarea (AC2 fails),
 *   - there is no second "Cancel" affordance to dismiss (AC3 fails).
 * The dev agent makes them pass by introducing CancelPollModal.
 *
 * Requires DEMO_MODE=true (auth bypass; admin is operator-or-above).
 */
import { test, expect } from './base';
import {
    API_BASE,
    getAdminToken,
    apiDelete,
    apiGet,
    pollForCondition,
} from './api-helpers';

const CANCEL_COPY =
    'Cancel this poll? Voters will be notified. This cannot be undone.';

/** Get a valid configured gameId from seeded data. */
async function getFirstGameId(token: string): Promise<number> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch games: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games');
    return body.data[0].id;
}

/** Create a standalone scheduling poll and return its ids. */
async function createStandalonePoll(
    token: string,
): Promise<{ id: number; lineupId: number }> {
    const gameId = await getFirstGameId(token);
    const createRes = await fetch(`${API_BASE}/scheduling-polls`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ gameId }),
    });
    expect(createRes.status).toBe(201);
    return createRes.json() as Promise<{ id: number; lineupId: number }>;
}

/**
 * Poll the scheduling poll endpoint until the freshly-created poll is
 * observable (mirrors standalone-scheduling-poll.smoke — the page's
 * useQuery has a 15s staleTime so a sibling test's cached empty fetch can
 * short-circuit the render otherwise).
 */
async function waitForPollObservable(
    token: string,
    lineupId: number,
    matchId: number,
): Promise<void> {
    await pollForCondition(
        async () => {
            const data = (await apiGet(
                token,
                `/lineups/${lineupId}/schedule/${matchId}`,
            )) as { match?: unknown } | null;
            return data?.match ? data : null;
        },
        { timeoutMs: 15_000, description: 'scheduling poll endpoint' },
    );
}

/**
 * Dismiss the GameTimeRefreshModal if it auto-opened (ROK-1301).
 *
 * On the scheduling poll page a `role="dialog"` from `components/ui/modal.tsx`
 * auto-opens when the operator's game time is stale — which is exactly the
 * fresh-DB state on CI runners (locally the dev admin already has fresh game
 * time, so the modal never appears, which is why this only reproduced in CI).
 * Its `fixed inset-0 z-50` backdrop intercepts pointer events and blocks the
 * "Cancel Poll" trigger. Skip persists to sessionStorage so it won't re-fire.
 * Mirrors `dismissGameTimeModalIfPresent` in scheduling-poll.smoke.spec.ts.
 */
async function dismissGameTimeModalIfPresent(
    page: import('@playwright/test').Page,
): Promise<void> {
    const dialog = page.getByRole('dialog');
    const modalTitle = dialog.getByText(
        /Set your Game Time|Refresh your Game Time/i,
    );
    if (
        await modalTitle.isVisible({ timeout: 1_500 }).catch(() => false)
    ) {
        await dialog.getByRole('button', { name: /^Skip$/i }).click();
        await expect(dialog).toBeHidden({ timeout: 10_000 });
    }
}

test.describe('Cancel Poll modal — operator flow (ROK-1219)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('clicking Cancel Poll opens the confirm modal and makes NO network call', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-first — modal copy is layout-equivalent across viewports',
        );

        const token = await getAdminToken();
        const poll = await createStandalonePoll(token);

        try {
            await waitForPollObservable(token, poll.lineupId, poll.id);
            await page.goto(
                `/community-lineup/${poll.lineupId}/schedule/${poll.id}`,
            );
            await expect(
                page.locator('[data-testid="scheduling-composite"]'),
            ).toBeVisible({ timeout: 15_000 });
            await dismissGameTimeModalIfPresent(page);

            // Track any call to the cancel endpoint — opening the modal must
            // not fire it.
            const cancelUrl = new RegExp(
                `/lineups/${poll.lineupId}/schedule/${poll.id}/cancel`,
            );
            let cancelCalled = false;
            page.on('request', (req) => {
                if (cancelUrl.test(req.url()) && req.method() === 'POST') {
                    cancelCalled = true;
                }
            });

            const cancelBtn = page.getByRole('button', { name: /Cancel Poll/i });
            await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
            await cancelBtn.click();

            // AC1: modal opens with the exact confirmation copy.
            const modal = page.locator('[role="dialog"]');
            await expect(modal).toBeVisible({ timeout: 10_000 });
            await expect(modal.getByText(CANCEL_COPY)).toBeVisible({
                timeout: 5_000,
            });

            // AC2: optional reason textarea present.
            await expect(modal.getByRole('textbox')).toBeVisible({
                timeout: 5_000,
            });

            // AC1: still NO network call to the cancel endpoint.
            expect(cancelCalled).toBe(false);
        } finally {
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });

    test('modal Cancel closes the modal with NO network call and leaves the page', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-first — modal dismissal is layout-equivalent across viewports',
        );

        const token = await getAdminToken();
        const poll = await createStandalonePoll(token);

        try {
            await waitForPollObservable(token, poll.lineupId, poll.id);
            await page.goto(
                `/community-lineup/${poll.lineupId}/schedule/${poll.id}`,
            );
            await expect(
                page.locator('[data-testid="scheduling-composite"]'),
            ).toBeVisible({ timeout: 15_000 });
            await dismissGameTimeModalIfPresent(page);

            const cancelUrl = new RegExp(
                `/lineups/${poll.lineupId}/schedule/${poll.id}/cancel`,
            );
            let cancelCalled = false;
            page.on('request', (req) => {
                if (cancelUrl.test(req.url()) && req.method() === 'POST') {
                    cancelCalled = true;
                }
            });

            await page
                .getByRole('button', { name: /Cancel Poll/i })
                .click();

            const modal = page.locator('[role="dialog"]');
            await expect(modal).toBeVisible({ timeout: 10_000 });
            await expect(modal.getByText(CANCEL_COPY)).toBeVisible({
                timeout: 5_000,
            });

            // AC3: dismiss via the modal's own Cancel button (the non-
            // destructive one). Scope to the modal and avoid the destructive
            // confirm.
            await modal
                .getByRole('button', { name: /^Cancel$/ })
                .click();

            // Modal closes, no cancel request fired, still on the poll page.
            await expect(modal).toBeHidden({ timeout: 10_000 });
            expect(cancelCalled).toBe(false);
            expect(page.url()).toContain(
                `/community-lineup/${poll.lineupId}/schedule/${poll.id}`,
            );
            await expect(
                page.locator('[data-testid="scheduling-composite"]'),
            ).toBeVisible({ timeout: 5_000 });
        } finally {
            await apiDelete(token, `/lineups/${poll.lineupId}`).catch(() => {});
        }
    });

    test('confirming with a reason cancels the poll and redirects to /events', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-first — full confirm flow',
        );

        const token = await getAdminToken();
        const poll = await createStandalonePoll(token);

        // No `finally` cleanup — a successful cancel archives the match; the
        // poll is intentionally retired by the flow under test.
        await waitForPollObservable(token, poll.lineupId, poll.id);
        await page.goto(
            `/community-lineup/${poll.lineupId}/schedule/${poll.id}`,
        );
        await expect(
            page.locator('[data-testid="scheduling-composite"]'),
        ).toBeVisible({ timeout: 15_000 });
        await dismissGameTimeModalIfPresent(page);

        await page.getByRole('button', { name: /Cancel Poll/i }).click();

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 10_000 });
        await expect(modal.getByText(CANCEL_COPY)).toBeVisible({
            timeout: 5_000,
        });

        // AC2/AC4: type a reason, then confirm via the destructive button.
        await modal
            .getByRole('textbox')
            .fill('Smoke test — cancelling this poll.');
        await modal
            .getByRole('button', { name: /Cancel Poll|Confirm/i })
            .last()
            .click();

        // AC4 (UI): redirected to /events once the cancel resolves.
        await page.waitForURL(/\/events(\?|$)/, { timeout: 25_000 });
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
        );
    });
});
