/**
 * Lineup Confirmation-Pattern smoke tests — INVITEE persona (ROK-1276).
 *
 * Companion spec to `lineup-confirmation-pills.smoke.spec.ts`. The organizer
 * spec runs as admin-as-creator → `organizer` persona because the shared
 * Playwright storageState authenticates as `admin@local`. This spec injects
 * a non-admin smoke-fixture user's JWT into `localStorage` so the lineup
 * detail page resolves to `invitee-not-acted` / `invitee-acted` and the
 * waiting-tone hero flip + per-row ✓ pills get exercised at the browser
 * level instead of only the vitest unit suite.
 *
 * Fixture user: stable `discord_id = 'smoke-invitee-fixture-001'`, idempotent
 * — re-seeded via `POST /admin/test/seed-fixture-user`. See
 * `api/src/admin/demo-test-fixture-user.controller.ts`.
 */
import { test, expect } from './base';
import {
    getAdminToken,
    getInviteeFixture,
    apiGet,
    apiPatch,
    apiPost,
    createLineupOrRetry,
    awaitProcessing,
    waitForLineupStatus,
} from './api-helpers';

const FILE_PREFIX = 'lineup-confirmation-pills-invitee';
let workerPrefix: string;
let adminToken: string;
let inviteeToken: string;
let lineupId: number;
let gameIds: number[] = [];

// Same hook-timeout rationale as the organizer spec — mobile project's
// parallel-worker contention can push API serialisation past Playwright's
// default 30s hook timeout under full-suite load.
const HOOK_TIMEOUT_MS = 90_000;

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length) {
        throw new Error('No games in DB - seed data missing');
    }
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

/**
 * Swap the browser session from the shared admin storageState to the
 * invitee fixture user by overwriting `localStorage.raid_ledger_token`
 * (matches `use-auth.ts` `TOKEN_KEY`). Reload so the auth hook re-resolves
 * with the new JWT.
 */
async function loginInvitee(
    page: import('@playwright/test').Page,
    token: string,
): Promise<void> {
    // Visit any same-origin page first so localStorage is bound to the app
    // origin — `page.evaluate` against `about:blank` writes to the wrong
    // storage partition and the subsequent reload reads `null`.
    await page.goto('/');
    await page.evaluate((t) => {
        localStorage.setItem('raid_ledger_token', t);
    }, token);
}

test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    adminToken = await getAdminToken();
    const invitee = await getInviteeFixture();
    inviteeToken = invitee.jwt;
    gameIds = await fetchGameIds(adminToken, 3);

    // Admin creates the lineup, then explicitly adds the fixture user to
    // the invitee list so `canParticipateInLineup` / persona logic
    // resolves to `invitee-*` rather than `uninvited`.
    const { id } = await createLineupOrRetry(
        adminToken,
        {
            title: `${workerPrefix}Smoke Lineup`,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );
    lineupId = id;
    await apiPost(adminToken, `/lineups/${id}/invitees`, {
        userIds: [invitee.userId],
    });
    await awaitProcessing(adminToken);
});

// ---------------------------------------------------------------------------
// Building phase — invitee-not-acted hero + invitee-acted waiting flip
// ---------------------------------------------------------------------------

test.describe('Building phase — invitee hero variants', () => {
    test.beforeEach(async () => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // Strip any prior nominations from this lineup so the persona is
        // recomputed against a clean slate every test.
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        for (const e of detail?.entries ?? []) {
            await apiPost(adminToken, `/lineups/${lineupId}/remove-nomination`, {
                gameId: e.gameId,
            }).catch(() => undefined);
        }
        await awaitProcessing(adminToken);
    });

    // ROK-1297 round 5ae: the legacy HeroNextStep banner is suppressed
    // during the `building` phase — see sibling spec
    // `lineup-confirmation-pills.smoke.spec.ts` for the rationale. Skip
    // until ROK-1323 finalizes the legacy chrome teardown.
    test.skip('invitee-not-acted: hero shows action-tone Nominate CTA', async ({ page }) => {
        await loginInvitee(page, inviteeToken);
        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        // Invitee-not-acted branch in `buildingCopy` — action tone, the
        // generic nominate prompt copy, no per-count framing.
        await expect(hero).toHaveAttribute('data-tone', 'action');
        await expect(hero).toContainText(/nominate the games you want to play/i);
        await expect(
            hero.getByRole('button', { name: /nominate a game/i }),
        ).toBeVisible();
    });

    test.skip('invitee-acted: hero flips to waiting tone after nomination', async ({ page }) => {
        // Nominate via API as the invitee so persona evaluates to
        // `invitee-acted` (per `hasUserActedInPhase` building branch:
        // entries.some(e => e.nominatedBy.id === user.id)).
        await apiPost(inviteeToken, `/lineups/${lineupId}/nominate`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await loginInvitee(page, inviteeToken);
        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        // Waiting-tone hero flip — buildingActed copy: "You nominated X
        // game. Sit tight — N of M still to go."
        await expect(hero).toHaveAttribute('data-tone', 'waiting');
        await expect(hero).toContainText(/sit tight/i);
        // No Advance CTA for an invitee — they only see the secondary
        // "Change my nomination" link.
        await expect(
            hero.getByRole('button', { name: /move lineup phase forward/i }),
        ).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// Voting phase — per-row ✓ on LeaderboardRow for the invitee's own vote
// ---------------------------------------------------------------------------

test.describe('Voting phase — per-row checkmark for invitee', () => {
    test.beforeAll(async () => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // Ensure 3 nominations exist (the admin-organizer spec exercises
        // the same setup — re-nominate any missing ones idempotently) and
        // advance to voting. Invitee fixture's own nomination from the
        // building tests above may or may not still be present depending
        // on test ordering; the `existingGameIds` check de-dupes either way.
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        const existingGameIds = new Set<number>(
            (detail?.entries ?? []).map((e: { gameId: number }) => e.gameId),
        );
        for (const gid of gameIds) {
            if (existingGameIds.has(gid)) continue;
            await apiPost(adminToken, `/lineups/${lineupId}/nominate`, {
                gameId: gid,
            });
        }
        await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
            status: 'voting',
        });
        await awaitProcessing(adminToken);
        // ROK-1286: gate on the server reporting `voting` before any test in
        // this describe navigates — same out-of-band-settle barrier as the
        // organizer spec's voting fixture.
        await waitForLineupStatus(adminToken, lineupId, 'voting');
    });

    // LEFT SKIPPED — root cause is NOT the original mobile staleTime flake;
    // the targeted element no longer exists. ROK-1298 rewrote the voting
    // phase to the cycle-4 `VotingComposite` → `VotingLeaderboardV2`, whose
    // rows are `data-testid="voting-row"` (VotingRow.tsx). The legacy
    // `data-testid="leaderboard-row"` is no longer rendered anywhere in the
    // voting flow (verified 2026-06-28). `data-voted` and the "You voted"
    // ✓ marker now live on `voting-row`, not `leaderboard-row`, so this
    // test's selectors resolve to zero elements regardless of timing.
    // Re-enabling requires re-targeting the assertion at `voting-row`
    // (a target change, out of scope for this flake-hardening pass).
    test.skip("invitee's voted row renders ✓ marker and data-voted='true'", async ({ page }) => {
        // Cast one vote AS THE INVITEE — the per-row checkmark depends on
        // `entry.myVote != null` for the requesting user, so the assertion
        // only fires when the invitee fixture's JWT drives both the API
        // call and the page load.
        await apiPost(inviteeToken, `/lineups/${lineupId}/vote`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await loginInvitee(page, inviteeToken);
        await page.goto(`/community-lineup/${lineupId}`);

        // Wait for the leaderboard to render before probing rows.
        const rows = page.getByTestId('leaderboard-row');
        await expect(rows.first()).toBeVisible({ timeout: 15_000 });

        // `data-voted` lives on the row itself (see LeaderboardRow.tsx),
        // so match the row attribute directly. Exactly one row should be
        // marked voted — we only cast one vote.
        const votedRow = page.locator(
            '[data-testid="leaderboard-row"][data-voted="true"]',
        );
        await expect(votedRow).toHaveCount(1, { timeout: 10_000 });
        // The aria-labelled "You voted" ✓ marker only renders on the
        // voted row — confirms the per-row pill is user-scoped to the
        // requester, not an organizer-only badge.
        await expect(votedRow.getByLabel(/you voted/i)).toBeVisible();
    });

    // LEFT SKIPPED — ROK-1323 retired the legacy HeroNextStep banner, so
    // `data-testid="hero-next-step"` is no longer rendered on the lineup
    // detail page (verified 2026-06-28). The voting phase now renders the
    // cycle-4 VotingComposite JourneyHero (role="region", name "Step 2 of 4 ·
    // Voting"); the waiting-tone hero data-tone attribute no longer exists
    // here. The selector resolves to zero elements regardless of timing, so
    // a wait fix cannot rescue it. Re-enabling requires re-targeting the
    // assertion at the VotingComposite JourneyHero (a target change, out of
    // scope for this flake-hardening pass).
    test.skip('invitee-acted: voting hero flips to waiting tone after one vote', async ({ page }) => {
        // The previous test cast one vote as the invitee. That alone
        // moves persona to `invitee-acted` and pushes the voting hero into
        // the waiting branch — no need to top up to the cap (the
        // organizer spec asserts the `waitingOnN` pill variant separately;
        // we focus on the hero data-tone here).
        await loginInvitee(page, inviteeToken);
        await page.goto(`/community-lineup/${lineupId}`);

        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        await expect(hero).toHaveAttribute('data-tone', 'waiting');
        // votingCopy invitee-acted branch — "You voted for N games. Sit
        // tight — X of Y still voting."
        await expect(hero).toContainText(/sit tight/i);
    });
});

// ---------------------------------------------------------------------------
// Mobile viewport — invitee hero sticky compact behaviour (AC-18)
// ---------------------------------------------------------------------------

test.describe('Mobile sticky hero — invitee', () => {
    // LEFT SKIPPED — ROK-1323 HAS landed the legacy chrome teardown:
    // `data-testid="hero-next-step"` (components/common/HeroNextStep.tsx) is
    // no longer rendered on the lineup detail page (verified 2026-06-28 —
    // only the type survives, imported by use-lineup-hero.ts). Sticky-compact
    // behaviour moved to the cycle-4 composite JourneyHero (sticky header in
    // NominatingComposite/VotingComposite). A dedicated decided-state
    // lineupId in a local beforeAll would not help — the element does not
    // exist to compact. Re-enabling requires re-targeting the scroll/compact
    // assertion at that composite's sticky region (a target change, out of
    // scope for this flake-hardening pass).
    test.skip('hero compacts after scrolling past sentinel on mobile', async ({ page }, testInfo) => {
        test.skip(
            testInfo.project.name === 'desktop',
            'Sticky compact mode is mobile-only per spec (AC-18).',
        );

        await loginInvitee(page, inviteeToken);
        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });

        // Same scroll trigger as the organizer mobile test — confirms the
        // sticky behaviour is persona-agnostic.
        await page.evaluate(() => window.scrollBy(0, 800));
        await expect(hero).toHaveAttribute('data-compact', 'true', {
            timeout: 5_000,
        });
    });
});

