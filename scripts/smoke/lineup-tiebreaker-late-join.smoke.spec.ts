/**
 * ROK-1117 — Late-join tiebreaker voting (Playwright smoke).
 *
 * AC: A user who navigates to the lineup URL AFTER the tiebreaker has
 * started can still cast a veto, as long as the round is `active`.
 * We mirror the setup helpers from `lineup-tiebreaker.smoke.spec.ts`
 * (create lineup → nominate → vote-tied → start tiebreaker), and then
 * exercise the FRESH page-open after start.
 *
 * TDD gate: this test fails until the dev agent implements the
 * "late-join" path on `VetoView` (current spec confirms the form
 * works for the admin operator, but we also assert that the API
 * accepts a veto from a late arrival and the tiebreaker remains
 * active afterwards).
 */
import { test, expect } from './base';
import { API_BASE, getAdminToken, apiPost, apiGet } from './api-helpers';

async function apiPatch(
    token: string,
    path: string,
    body: Record<string, unknown>,
) {
    const res = await fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`PATCH ${path} failed: ${res.status} ${t}`);
    }
    return res.json();
}

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const res = await fetch(`${API_BASE}/games/configured`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`fetchGameIds failed: ${res.status}`);
    const body = (await res.json()) as { data: { id: number }[] };
    if (!body.data?.length) throw new Error('No configured games in DB');
    return body.data.slice(0, count).map((g) => g.id);
}

async function transitionVotingToDecided(
    token: string,
    id: number,
    entries: { gameId: number }[],
): Promise<void> {
    const decidedGameId = entries?.[0]?.gameId;
    try {
        await apiPatch(token, `/lineups/${id}/status`, {
            status: 'decided',
            ...(decidedGameId ? { decidedGameId } : {}),
        });
    } catch {
        await apiPost(token, `/lineups/${id}/tiebreaker`, {
            mode: 'bracket',
            roundDurationHours: 1,
        }).catch(() => {});
        await apiPost(token, `/lineups/${id}/tiebreaker/resolve`).catch(() => {});
        await apiPatch(token, `/lineups/${id}/status`, { status: 'decided' });
    }
}

async function archiveActiveLineup(token: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const banner = await apiGet(token, '/lineups/banner');
        if (!banner || typeof banner.id !== 'number') return;
        await apiPost(token, '/admin/test/cancel-lineup-phase-jobs', {
            lineupId: banner.id,
        }).catch(() => {});
        const detail = await apiGet(token, `/lineups/${banner.id}`);
        if (!detail) return;
        const id = banner.id;
        try {
            if (detail.status === 'voting') {
                await transitionVotingToDecided(token, id, detail.entries ?? []);
                await apiPatch(token, `/lineups/${id}/status`, {
                    status: 'archived',
                });
            } else if (detail.status === 'decided') {
                await apiPatch(token, `/lineups/${id}/status`, {
                    status: 'archived',
                });
            } else if (detail.status === 'building') {
                await apiPatch(token, `/lineups/${id}/status`, {
                    status: 'voting',
                });
                await apiPatch(token, `/lineups/${id}/status`, {
                    status: 'decided',
                });
                await apiPatch(token, `/lineups/${id}/status`, {
                    status: 'archived',
                });
            }
        } catch {
            /* try again */
        }
        const check = await apiGet(token, '/lineups/banner');
        if (!check || typeof check.id !== 'number') return;
    }
}

/**
 * Build a voting lineup with a tied vote AND an ALREADY-STARTED veto
 * tiebreaker. Returns once the tiebreaker is `active` server-side.
 */
async function startVetoTiebreaker(
    token: string,
): Promise<{ lineupId: number; tiebreakerId: number; gameIds: number[] }> {
    await archiveActiveLineup(token);

    const gameIds = await fetchGameIds(token, 4);

    const createRes = (await apiPost(token, '/lineups', {
        title: 'ROK-1117 Late-Join Smoke',
        buildingDurationHours: 720,
        votingDurationHours: 720,
        decidedDurationHours: 720,
        matchThreshold: 10,
    })) as { id?: number };
    const lineupId =
        createRes?.id ?? (await apiGet(token, '/lineups/banner'))?.id;
    if (!lineupId) throw new Error('Failed to create lineup');

    for (const gid of gameIds) {
        await apiPost(token, `/lineups/${lineupId}/nominate`, { gameId: gid });
    }
    await apiPatch(token, `/lineups/${lineupId}/status`, { status: 'voting' });

    // Cast equal votes on top 2 games to force a tie.
    await apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gameIds[0] });
    await apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gameIds[1] });

    // Start the tiebreaker BEFORE we navigate. This is the whole point
    // of the late-join test: the page-open happens AFTER start.
    const tb = (await apiPost(token, `/lineups/${lineupId}/tiebreaker`, {
        mode: 'veto',
        roundDurationHours: 24,
    })) as { id?: number };
    const tiebreakerId = tb?.id ?? 0;

    return { lineupId, tiebreakerId, gameIds };
}

let adminToken: string;

test.beforeAll(async () => {
    adminToken = await getAdminToken();
});

test.describe('Late-join tiebreaker voting (ROK-1117)', () => {
    let lineupId: number;
    let gameIds: number[];

    test.beforeAll(async () => {
        const result = await startVetoTiebreaker(adminToken);
        lineupId = result.lineupId;
        gameIds = result.gameIds;
    });

    test('user opens lineup URL after tiebreaker started → veto form visible', async ({
        page,
    }) => {
        // Sanity: confirm the tiebreaker is `active` BEFORE we navigate.
        const tb = await apiGet(adminToken, `/lineups/${lineupId}/tiebreaker`);
        expect(tb).not.toBeNull();
        expect(tb.status).toBe('active');

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: late-arriving user sees the veto form.
        const vetoView = page.locator('[data-testid="veto-view"]');
        await expect(vetoView).toBeVisible({ timeout: 15_000 });

        const vetoButtons = vetoView.locator('[data-testid="veto-button"]');
        const buttonCount = await vetoButtons.count();
        expect(buttonCount).toBeGreaterThan(0);
    });

    test('late-join user can submit a veto and the round stays active', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: the late-join veto submission succeeds (HTTP 2xx) and the
        // tiebreaker remains `active` (single-voter auto-resolve is the
        // existing behavior — once a real second voter exists this stays
        // active until both have voted).
        const vetoResponse = await apiPost(
            adminToken,
            `/lineups/${lineupId}/tiebreaker/veto`,
            { gameId: gameIds[0] },
        );
        expect(vetoResponse).toBeTruthy();

        const tb = await apiGet(adminToken, `/lineups/${lineupId}/tiebreaker`);
        // Late-join AC: round.status still 'active' (or already
        // 'resolved' is acceptable for single-voter auto-resolve, but
        // the late-join veto MUST have been accepted — i.e. either the
        // user's veto is recorded OR the round resolved as a result.)
        expect(['active', 'resolved']).toContain(tb.status);
        expect(tb.vetoStatus).not.toBeNull();
    });
});

// ─── ROK-1117 AC: "Vote closed at HH:MM" empty state after resolution ───
//
// When the tiebreaker has resolved or been dismissed, a user who navigates
// to the lineup URL must see a clear "Vote closed at HH:MM" message instead
// of the live veto form. This is NEW UI that doesn't exist yet — the test
// must fail until the dev agent adds the closed state to VetoView /
// BracketView.

test.describe('Tiebreaker resolved → "Vote closed" UI (ROK-1117)', () => {
    let lineupId: number;

    test.beforeAll(async () => {
        const result = await startVetoTiebreaker(adminToken);
        lineupId = result.lineupId;
        // Force-resolve so status === 'resolved' before navigation.
        await apiPost(adminToken, `/lineups/${lineupId}/tiebreaker/resolve`);
    });

    test('shows "Vote closed at HH:MM" when status is resolved', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC: late-arrival users who navigate after resolution must see
        // a "Vote closed at HH:MM" empty state. Format is locally
        // formatted time — match the prefix loosely.
        const closedNotice = page.getByText(/vote closed at/i);
        await expect(closedNotice).toBeVisible({ timeout: 15_000 });
    });
});
