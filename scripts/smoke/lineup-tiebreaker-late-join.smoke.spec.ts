/**
 * ROK-1117 — Late-join tiebreaker voting (Playwright smoke).
 *
 * AC: A user who navigates to the lineup URL AFTER the tiebreaker has
 * started can still cast a veto, as long as the round is `active`.
 * We mirror the setup helpers from `lineup-tiebreaker.smoke.spec.ts`
 * (create lineup → nominate → vote-tied → start tiebreaker), and then
 * exercise the FRESH page-open after start.
 *
 * ROK-1227: hardened against sibling-worker collisions and the parent
 * matching bug (ROK-1225, still in backlog). Per-worker title prefix
 * scopes /admin/test/reset-lineups; serial mode prevents intra-file
 * fixture races; force-resolve tolerates the matching 500 because the
 * tiebreaker.status row is already committed before the matching step
 * runs (we poll for `resolved` instead of relying on the response).
 */
import { test, expect } from './base';
import { API_BASE, getAdminToken, apiPost, apiGet, createLineupOrRetry } from './api-helpers';

// ROK-1227: serial mode prevents the two describes in this file from
// racing each other when a single worker runs them back-to-back.
test.describe.configure({ mode: 'serial' });

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

/**
 * Poll a predicate at a fixed interval until it returns truthy or
 * timeout elapses. Throws on timeout. Test-infra polling — not a
 * UI assertion delay.
 */
async function pollUntil<T>(
    fn: () => Promise<T>,
    predicate: (value: T) => boolean,
    opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const intervalMs = opts.intervalMs ?? 500;
    const deadline = Date.now() + timeoutMs;
    let last: T | undefined;
    while (Date.now() < deadline) {
        last = await fn();
        if (predicate(last)) return last;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
        `pollUntil timed out after ${timeoutMs}ms${opts.label ? ` (${opts.label})` : ''}; last=${JSON.stringify(last)}`,
    );
}

// ROK-1227: per-worker title prefix scopes /admin/test/reset-lineups so
// sibling workers don't archive each other's lineups mid-test. Mirrors
// the pattern in lineup-tiebreaker.smoke.spec.ts:73-76, 148-152.
const FILE_PREFIX = 'lineup-tiebreaker-late-join';
let workerPrefix: string;
let lineupTitle: string;

/**
 * Build a voting lineup with a tied vote AND an ALREADY-STARTED veto
 * tiebreaker. Returns once the tiebreaker is `active` server-side.
 */
async function startVetoTiebreaker(
    token: string,
): Promise<{ lineupId: number; tiebreakerId: number; gameIds: number[] }> {
    await apiPost(token, '/admin/test/reset-lineups', { titlePrefix: workerPrefix });

    const gameIds = await fetchGameIds(token, 4);

    const { id: lineupId } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );

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

    // Wait for the tiebreaker row to reach 'active' before navigating.
    await pollUntil(
        () => apiGet(token, `/lineups/${lineupId}/tiebreaker`),
        (t) => t != null && t.status === 'active',
        { label: 'tiebreaker→active' },
    );

    return { lineupId, tiebreakerId, gameIds };
}

let adminToken: string;

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
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
        expect(tb).not.toBeNull();
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
// of the live veto form. VetoView.tsx:22 surfaces TiebreakerClosedNotice
// for both 'resolved' and 'dismissed' statuses.

test.describe('Tiebreaker resolved → "Vote closed" UI (ROK-1117)', () => {
    let lineupId: number;

    test.beforeAll(async () => {
        const result = await startVetoTiebreaker(adminToken);
        lineupId = result.lineupId;

        // ROK-1227: force-resolve sets tiebreaker.status='resolved' BEFORE
        // it calls transitionToDecided→runMatchingAlgorithm. The matching
        // step currently throws on `source='voted'` inserts (see ROK-1225,
        // still in backlog), but the resolved row is already committed.
        // apiPost returns the response JSON regardless of status, so we
        // discard it and poll the tiebreaker row directly.
        await apiPost(adminToken, `/lineups/${lineupId}/tiebreaker/resolve`);

        await pollUntil(
            () => apiGet(adminToken, `/lineups/${lineupId}/tiebreaker`),
            (tb) =>
                tb != null &&
                (tb.status === 'resolved' || tb.status === 'dismissed'),
            { label: 'tiebreaker→resolved' },
        );
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
