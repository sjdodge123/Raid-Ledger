/**
 * Lineup Confirmation-Pattern smoke tests (ROK-1209).
 *
 * Verifies AC-14, AC-16, AC-17, AC-18 end-to-end on the lineup detail page
 * across building, voting, and decided phases. Both desktop and mobile
 * Playwright projects exercise these tests per CLAUDE.md.
 *
 * Setup: per-worker prefixed lineup created in `beforeAll`. The admin user
 * is the creator and therefore resolves to the **organizer** persona (per
 * `getLineupPersona`: `isOperatorOrAdmin && creator → 'organizer'`). These
 * smoke tests assert organizer-persona hero copy + CTA wiring + the
 * confirmation pill rendering when the organizer themselves nominates/votes.
 * Invitee-acted / invitee-not-acted persona variants are covered
 * exhaustively by the vitest unit suite for `useLineupHero`,
 * `getLineupPersona`, `hasUserActedInPhase`, and `getLineupHeroCopy` —
 * smoke does not exercise them because there is no non-admin fixture user
 * available to the smoke harness today (tracked in TECH-DEBT-BACKLOG.md
 * 2026-05-09).
 *
 * NOTE: dev-brief and build-state.yaml referenced the path
 * `web/playwright/lineup-confirmation-pills.spec.ts`. The repo's
 * `playwright.config.ts` reads `./scripts/smoke/*.smoke.spec.ts`, so the
 * canonical home is here. Reported back to Lead as a spec-path gap.
 */
import { test, expect } from './base';
import {
    getAdminToken,
    apiGet,
    apiPatch,
    apiPost,
    createLineupOrRetry,
    awaitProcessing,
} from './api-helpers';

const FILE_PREFIX = 'lineup-confirmation-pills';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;
let lineupId: number;
let gameIds: number[] = [];

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length) {
        throw new Error('No games in DB - seed data missing');
    }
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

// Mobile project parallel-worker contention causes the API serialisation
// window for `getAdminToken` + `createLineupOrRetry` to exceed Playwright's
// default 30s hook timeout under full-suite load. Bumping per-hook timeouts
// to 90s keeps these fixtures robust without weakening the assertions
// themselves. Same root cause as the rotating mobile-suite flake tracked
// in TECH-DEBT-BACKLOG.md (2026-05-05 / 2026-05-09 entries).
const HOOK_TIMEOUT_MS = 90_000;

test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
    adminToken = await getAdminToken();
    gameIds = await fetchGameIds(adminToken, 3);

    const { id } = await createLineupOrRetry(
        adminToken,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
        },
        workerPrefix,
    );
    lineupId = id;
});

// ---------------------------------------------------------------------------
// Building phase — hero CTA opens nominate modal; pill appears post-nominate
// ---------------------------------------------------------------------------

test.describe('Building phase — hero + pill', () => {
    test.beforeEach(async () => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // Ensure no nominations from previous tests linger.
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        for (const e of detail?.entries ?? []) {
            await apiPost(adminToken, `/lineups/${lineupId}/remove-nomination`, {
                gameId: e.gameId,
            }).catch(() => undefined);
        }
        await awaitProcessing(adminToken);
    });

    // ROK-1297 round 5ae: the legacy HeroNextStep banner is suppressed
    // during the `building` phase — the NominatingComposite's U1
    // JourneyHero replaces it. These three building-phase tests assert
    // the old banner; they should be rewritten against the new composite
    // when ROK-1323 finalizes the legacy chrome teardown. Equivalent
    // behaviour is verified at the vitest unit layer (useLineupHero,
    // getLineupHeroCopy) and at scripts/smoke/lineup-nominating-
    // composite.smoke.spec.ts.
    test.skip('hero shows action tone with Nominate CTA when organizer has not nominated', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        await expect(hero).toHaveAttribute('data-tone', 'action');
        // ROK-1253 (PR #770): an organizer who hasn't nominated themselves
        // sees the same nominate prompt as an invitee — they're part of
        // the expected-voter set, so leading with "Advance to Voting"
        // would be skipping their own participation. Once they nominate,
        // the next test ('hero copy reflects current nomination count for
        // organizer') asserts the flip to the advance CTA.
        await expect(hero.getByRole('button', { name: /nominate a game/i })).toBeVisible();
        await expect(hero).toContainText(/nominate the games you want to play/i);
    });

    test.skip('hero copy reflects current nomination count for organizer', async ({ page }) => {
        // Nominate via API so the organizer-flavored "X of Y nominated" copy
        // includes the count. Validates AC-15 (copy chosen by persona × phase
        // × current state — count refreshes when state changes).
        await apiPost(adminToken, `/lineups/${lineupId}/nominate`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        // Organizer copy: "{N} of {M} nominated. Advance to Voting when ready."
        await expect(hero).toContainText(/\d+ of \d+ nominated/i);
        // The CTA's visible text says "Advance to Voting" but its
        // accessible name is the generic "Advance lineup phase" — keeps
        // it from colliding with the phase-breadcrumb's "Voting" button at
        // page-level selectors. Match by aria-label here, plus assert the
        // visible text via toContainText.
        await expect(hero.getByRole('button', { name: /move lineup phase forward/i })).toBeVisible();
        await expect(hero).toContainText(/advance to voting/i);
    });

    test.skip("after nominating, per-card pill appears on organizer's nominated card", async ({ page }) => {
        // Nominate via API to keep the test deterministic. Pill renders
        // because `entry.nominatedBy.id === user.id` regardless of persona —
        // organizer who self-nominates still sees their own pill.
        await apiPost(adminToken, `/lineups/${lineupId}/nominate`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        // Wait for the lineup detail to render.
        await expect(
            page.getByRole('heading', { level: 1, name: /Smoke Lineup/i }),
        ).toBeVisible({ timeout: 15_000 });

        const pill = page.getByTestId('confirmation-pill').first();
        await expect(pill).toBeVisible({ timeout: 10_000 });
        await expect(pill).toContainText(/your nomination/i);

        // Hero stays action-tone for organizer (no waiting flip — that's
        // the invitee-acted variant, covered by vitest).
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toHaveAttribute('data-tone', 'action');
    });
});

// ---------------------------------------------------------------------------
// Voting phase — pill flips to waitingOnN at the limit
// ---------------------------------------------------------------------------

test.describe('Voting phase — pill variant transitions', () => {
    test.beforeAll(async () => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // Ensure 3 nominations and advance.
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
    });

    test("pill shows 'count' variant before reaching the vote limit", async ({ page }) => {
        // Cast 1 vote.
        await apiPost(adminToken, `/lineups/${lineupId}/vote`, {
            gameId: gameIds[0],
        });
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        // ROK-1298: voting surface replaced the legacy `confirmation-pill`
        // with the dedicated `votes-used-pill` ("X of N votes used") rendered
        // by the Sv composite above the leaderboard. Other surfaces still use
        // ConfirmationPill; voting does not.
        const pill = page.getByTestId('votes-used-pill');
        await expect(pill).toBeVisible({ timeout: 15_000 });
        // 1 of N votes used (where N = maxVotesPerPlayer, default 3).
        await expect(pill).toContainText(/1 of \d+ votes used/i);
    });

    // LEFT SKIPPED — root cause is NOT the original staleTime/propagation
    // flake (2026-05-19 note); the targeted element no longer exists.
    // ROK-1298 rewrote the voting phase: `LineupDetailBody` now renders the
    // cycle-4 `VotingComposite`, which shows `votes-used-pill` (VotesUsedPill,
    // copy "{n} of {m} votes used") above `VotingLeaderboardV2` (rows are
    // `voting-row`). `ConfirmationPill` (`data-testid="confirmation-pill"`)
    // and its `waitingOnN` "waiting on N others" copy are no longer in the
    // voting flow at all — ConfirmationPill only renders in NominationCard
    // (building) and the tiebreaker BracketView/VetoView. So this test's
    // selector + copy resolve to zero elements regardless of how long we
    // poll; a wait fix cannot rescue it. Re-enabling requires REWRITING the
    // assertion against `votes-used-pill` reaching "{max} of {max} votes
    // used" (a behavior/target change, out of scope for flake-hardening).
    // Verified 2026-06-28: confirmation-pill render sites are NominationCard,
    // BracketView, VetoView only (no voting-phase site).
    test.skip("pill flips to waitingOnN variant after using all votes", async ({ page }) => {
        // Top up to the cap.
        for (const gid of gameIds.slice(1)) {
            await apiPost(adminToken, `/lineups/${lineupId}/vote`, {
                gameId: gid,
            }).catch(() => undefined);
        }
        await awaitProcessing(adminToken);

        await page.goto(`/community-lineup/${lineupId}`);
        const pill = page.getByTestId('confirmation-pill').first();
        await expect(pill).toBeVisible({ timeout: 15_000 });
        await expect(pill).toContainText(/waiting on/i);
    });
});

// ---------------------------------------------------------------------------
// Decided phase — hero shows 'Schedule {gameName}' CTA
// ---------------------------------------------------------------------------

test.describe('Decided phase — hero schedule CTA', () => {
    test.beforeAll(async () => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // Advance to decided. Use the admin's first vote as the decided game.
        await apiPatch(adminToken, `/lineups/${lineupId}/status`, {
            status: 'decided',
            decidedGameId: gameIds[0],
        });
        await awaitProcessing(adminToken);
    });

    // LEFT SKIPPED — root cause is NOT the original staleTime/propagation
    // flake (2026-05-19 note); the targeted element no longer exists.
    // ROK-1323 FULLY retired the legacy `HeroNextStep` banner: the only
    // `data-testid="hero-next-step"` source (components/common/HeroNextStep
    // .tsx) is no longer rendered on the lineup detail page — only its
    // `HeroNextStepProps` type survives, imported by use-lineup-hero.ts
    // (verified 2026-06-28: no JSX usage outside web/src/dev + tests, and
    // lineup-detail-page.tsx:200 documents the retirement). The decided
    // phase now renders `DecidedView` whose JourneyHero carries the schedule
    // CTA. `getByTestId('hero-next-step')` therefore resolves to zero
    // elements regardless of timing, so polling the lineup status to
    // `decided`/abortedAt===null cannot rescue it. Re-enabling requires
    // re-targeting the assertion at the DecidedView composite's schedule
    // CTA (a behavior/target change, out of scope for flake-hardening).
    test.skip('hero offers schedule CTA referencing the decided game name', async ({ page }) => {
        await page.goto(`/community-lineup/${lineupId}`);

        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });
        // Organizer copy is "Open scheduling" (decided phase, hasGame). The
        // regex must match "schedul" so it works for both the invitee
        // "Schedule {gameName}" form (covered by vitest) and the organizer
        // "Open scheduling" form. /schedule/i alone fails because
        // "scheduling" lacks the literal "schedule" substring.
        await expect(hero.getByRole('button', { name: /schedul/i })).toBeVisible({
            timeout: 5_000,
        });
    });
});

// ---------------------------------------------------------------------------
// Mobile sticky compact behaviour (AC-18) — mobile project only
// ---------------------------------------------------------------------------

test.describe('Mobile sticky hero', () => {
    // LEFT SKIPPED — the original diagnosis (cross-describe lineupId
    // pollution + mobile staleTime flake) is now superseded by a hard
    // blocker: ROK-1323 fully retired the legacy `HeroNextStep` banner, so
    // `data-testid="hero-next-step"` is no longer rendered on the lineup
    // detail page (verified 2026-06-28 — only the type survives; see the
    // decided-phase test above for the full retirement note). Switching to a
    // dedicated per-test decided-state lineupId in a local beforeAll (the
    // suggested isolation fix) would NOT help — the element does not exist
    // to compact. Sticky-compact behaviour moved to the cycle-4 composite
    // JourneyHero (sticky header in VotingComposite/NominatingComposite).
    // Re-enabling requires re-targeting the scroll/compact assertion at that
    // composite's sticky region, not a wait/isolation fix — out of scope for
    // flake-hardening.
    test.skip('hero compacts after scrolling past sentinel on mobile', async ({ page }, testInfo) => {
        test.skip(
            testInfo.project.name === 'desktop',
            'Sticky compact mode is mobile-only per spec (AC-18).',
        );

        await page.goto(`/community-lineup/${lineupId}`);
        const hero = page.getByTestId('hero-next-step');
        await expect(hero).toBeVisible({ timeout: 15_000 });

        // Scroll past the sentinel; data-compact should flip to "true".
        await page.evaluate(() => window.scrollBy(0, 800));
        await expect(hero).toHaveAttribute('data-compact', 'true', {
            timeout: 5_000,
        });
    });
});
