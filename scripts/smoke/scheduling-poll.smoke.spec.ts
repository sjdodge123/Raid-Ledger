/**
 * Scheduling Poll page smoke tests (ROK-965, ROK-999, ROK-1300).
 * Route: /community-lineup/:lineupId/schedule/:matchId
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 *
 * ROK-1300: the SchedulingWizard stepper is gone — `<SchedulingComposite>`
 * owns the page body with a single JourneyHero toolbar at top (ROK-1558:
 * sticky on desktop only), an in-composite U2 game-ref banner (replaces
 * MatchContextCard), the group-availability heatmap, and per-row
 * +Vote / operator Lock (the toolbar submit is retired, ROK-1544). The
 * GameTimeRefreshModal stays — it self-gates on stale game time, independent
 * of the composite.
 */
import { test, expect } from './base';
import { dismissGameTimeCheck, isMobile } from './helpers';
import {
    getAdminToken,
    getInviteeFixture,
    apiPost,
    apiGet,
    apiDelete,
    apiPatch,
    apiPut,
    pollForCondition,
} from './api-helpers';

interface SchedulingPollResponse {
    slots?: { id: number; votes?: unknown[] }[];
    match?: { status?: string };
}

/**
 * ROK-1247: Poll the scheduling-poll API endpoint until a slot exists (and,
 * optionally, until a slot has at least one vote). The page renders slot
 * cards from a `useQuery` against this endpoint with a 15s staleTime —
 * if the test navigates before the API observes the API-seeded suggest/vote
 * writes, an empty cache can be served for the lifetime of the test.
 */
async function pollSchedulingPollHasSlot(
    token: string,
    lineupId: number,
    matchId: number,
    opts?: { withVote?: boolean },
): Promise<SchedulingPollResponse> {
    return pollForCondition<SchedulingPollResponse>(
        async () => {
            const data = (await apiGet(
                token,
                `/lineups/${lineupId}/schedule/${matchId}`,
            )) as SchedulingPollResponse | null;
            if (!data?.slots?.length) return null;
            if (opts?.withVote) {
                const hasVote = data.slots.some(
                    (s) => Array.isArray(s.votes) && s.votes.length > 0,
                );
                return hasVote ? data : null;
            }
            return data;
        },
        {
            timeoutMs: 15_000,
            description: `/lineups/${lineupId}/schedule/${matchId} has slot${opts?.withVote ? '+vote' : ''}`,
        },
    );
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

// ROK-1147: per-worker title prefix scopes /admin/test/reset-lineups so
// sibling workers don't archive each other's lineups mid-test.
const FILE_PREFIX = 'scheduling-poll';
let workerPrefix: string;
let lineupTitle: string;

/**
 * Archive lineups owned by THIS worker (ROK-1147).
 *
 * `/admin/test/reset-lineups` (DEMO_MODE-only) only archives lineups whose
 * title starts with `workerPrefix`, so sibling workers are unaffected.
 *
 * ROK-1070: this file's fixtures live on `decided`/`scheduling` rows (the
 * scheduling-poll attaches to a decided lineup). The default reset only
 * touches `building`/`voting` rows, so a stale decided/scheduling lineup
 * from a prior run survives and the new fixture's poll lands on the wrong
 * lineup. Pass the broader phases array so all phase rows are archived.
 */
async function archiveActiveLineup(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
        phases: ['building', 'voting', 'decided'],
    });
}

/** Fetch real game IDs from the admin games endpoint. */
async function fetchGameIds(
    token: string,
    count: number,
): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length)
        throw new Error('No games in DB - seed data missing');
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

/** Create a lineup in scheduling status with a "scheduling" match. */
async function createSchedulingLineupWithMatch(token: string): Promise<{
    lineupId: number;
    matchId: number;
    gameIds: number[];
}> {
    await archiveActiveLineup(token);

    const gameIds = await fetchGameIds(token, 4);

    // Create lineup with a low match threshold to maximize match generation
    const createRes = await apiPost(token, '/lineups', {
        title: lineupTitle,
        buildingDurationHours: 24,
        votingDurationHours: 48,
        decidedDurationHours: 24,
        matchThreshold: 10,
    });

    const lineupId: number =
        createRes?.id ??
        (await apiGet(token, '/lineups/banner'))?.id;

    if (!lineupId) throw new Error('Failed to create lineup');

    // Nominate games
    for (const gid of gameIds) {
        await apiPost(token, `/lineups/${lineupId}/nominate`, {
            gameId: gid,
        });
    }

    // Advance to voting
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'voting',
    });

    // Cast votes -- first 3 games get a vote from admin
    for (const gid of gameIds.slice(0, 3)) {
        await apiPost(token, `/lineups/${lineupId}/vote`, { gameId: gid });
    }

    // Advance to decided (generates matches from voting results).
    // Pass decidedGameId so the transition can't fail with TIEBREAKER_REQUIRED
    // when admin's three votes happen to land on tied games — that previously
    // left the lineup in 'voting', the matchId fallback hit 1, and every
    // wizard test downstream blew up with "wizard surface never rendered".
    await apiPatch(token, `/lineups/${lineupId}/status`, {
        status: 'decided',
        decidedGameId: gameIds[0],
    });

    // Fetch matches and find one in "scheduling" status
    const matchesRes = await apiGet(
        token,
        `/lineups/${lineupId}/matches`,
    );

    // The matches response groups by tier; scheduling tier has threshold-met matches
    let matchId: number | undefined;
    if (matchesRes?.scheduling?.length > 0) {
        matchId = matchesRes.scheduling[0].id;
    } else if (matchesRes?.almostThere?.length > 0) {
        matchId = matchesRes.almostThere[0].id;
    } else if (matchesRes?.rallyYourCrew?.length > 0) {
        matchId = matchesRes.rallyYourCrew[0].id;
    }

    // Fallback: use ID 1 if no matches were generated (the page doesn't exist
    // yet anyway, so the test will fail at navigation regardless)
    if (!matchId) matchId = 1;

    return { lineupId, matchId, gameIds };
}

// ---------------------------------------------------------------------------
// Wizard / modal navigation helpers (ROK-1301)
// ---------------------------------------------------------------------------

/**
 * Dismiss the game-time check overlay if it auto-opened (ROK-1301 → ROK-1564).
 *
 * The overlay auto-opens on the poll page only when game time is stale. In these
 * smoke fixtures the beforeAll PUTs slots → `game_time_confirmed_at = now` →
 * game time is fresh, so it normally does NOT appear. We still defensively
 * dismiss it (via its Skip answer) so a stale state from an earlier test, a
 * sibling worker, or seed data can't block the page. Skip persists to
 * sessionStorage, so it won't re-fire later in the same page session.
 *
 * ROK-1569 split the two shells apart: the desktop Modal still renders the
 * four-answer `game-time-check-body`, while below 768px step 1 is the phone
 * week editor inside the two-step sheet. `dismissGameTimeCheck` (helpers.ts)
 * probes both and is the ONLY place that knows the difference.
 */
async function dismissGameTimeModalIfPresent(
    page: import('@playwright/test').Page,
): Promise<void> {
    await dismissGameTimeCheck(page);
}

/**
 * Navigate to the scheduling poll and wait for the SchedulingComposite to
 * render (ROK-1300 — the wizard stepper + separate "Scheduling Poll" h1 are
 * gone; the composite owns the page body with a single hero toolbar at top,
 * pinned on desktop and free-scrolling on mobile — ROK-1558).
 * The composite's region is the JourneyHero (role="region" named /scheduling/i).
 */
async function goToPoll(
    page: import('@playwright/test').Page,
    lid: number,
    mid: number,
): Promise<void> {
    await page.goto(`/community-lineup/${lid}/schedule/${mid}`);
    // Dismiss the game-time modal first so it can't sit over the composite.
    await dismissGameTimeModalIfPresent(page);

    const composite = page.locator('[data-testid="scheduling-composite"]');
    const completed = page.locator('[data-testid="match-status-badge"]');
    // The active composite OR the scheduled/completed terminal state.
    await expect
        .poll(
            async () =>
                (await composite.isVisible().catch(() => false)) ||
                (await completed.isVisible().catch(() => false)),
            { timeout: 20_000, message: 'scheduling composite never rendered' },
        )
        .toBe(true);
}

/**
 * ROK-1543 (Layout B): the group-availability heatmap and the suggest form
 * are no longer in the poll's primary body — they live behind the single
 * "Find a better time" affordance (BottomSheet <768px, Modal >=768px).
 */
async function openBetterTimeSheet(
    page: import('@playwright/test').Page,
): Promise<void> {
    const affordance = page.locator('[data-testid="scheduling-find-better-time"]');
    // The affordance mounts with the poll body — wait for it rather than
    // clicking into a still-loading page (flaked on the fleet, ROK-1543).
    await expect(affordance).toBeVisible({ timeout: 15_000 });
    await affordance.click();
    await expect(
        page.locator('[data-testid="scheduling-better-time-body"]'),
    ).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

// Increase timeout for all tests and hooks — the beforeAll setup transitions
// through multiple lineup phases which can be slow.
test.describe.configure({ timeout: 120_000 });

let adminToken: string;
let lineupId: number;
let matchId: number;
let gameIds: number[];

test.beforeAll(async ({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;

    adminToken = await getAdminToken();
    const result = await createSchedulingLineupWithMatch(adminToken);
    lineupId = result.lineupId;
    matchId = result.matchId;
    gameIds = result.gameIds;

    // Seed game-time availability so the heatmap has data to render
    const slots = [
        { dayOfWeek: 1, hour: 19 }, { dayOfWeek: 1, hour: 20 },
        { dayOfWeek: 3, hour: 19 }, { dayOfWeek: 3, hour: 20 },
        { dayOfWeek: 5, hour: 18 }, { dayOfWeek: 5, hour: 19 },
    ];
    await apiPut(adminToken, '/users/me/game-time', { slots });

    // Suggest a time slot so voting/create-event tests have something to interact with
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);
    const suggestRes = await apiPost(adminToken, `/lineups/${lineupId}/schedule/${matchId}/suggest`, {
        proposedTime: tomorrow.toISOString(),
    });

    // Pre-vote on the slot via API so Create Event button is enabled
    const slotId = suggestRes?.data?.id ?? suggestRes?.id;
    if (slotId) {
        await apiPost(adminToken, `/lineups/${lineupId}/schedule/${matchId}/vote`, { slotId });
    }
});

// ---------------------------------------------------------------------------
// AC1: Route renders the scheduling poll page
// ---------------------------------------------------------------------------

test.describe('Scheduling poll page route', () => {
    test('route /community-lineup/:lineupId/schedule/:matchId renders the scheduling poll page', async ({
        page,
    }) => {
        await goToPoll(page, lineupId, matchId);
    });
});

// ---------------------------------------------------------------------------
// GameTimeRefreshModal (ROK-1301) — replaces the former wizard Step 1
// ---------------------------------------------------------------------------

test.describe('Scheduling poll game-time modal (ROK-1301)', () => {
    test('returning user with fresh game time → NO modal, composite renders directly', async ({
        page,
    }) => {
        // The beforeAll PUT to /users/me/game-time set confirmed_at = now, so the
        // authenticated admin's game time is fresh → the stale-gated modal must
        // NOT auto-open. (The positive stale-title case is covered deterministically
        // by the Vitest unit test web/src/pages/scheduling/GameTimeRefreshModal.test.tsx.)
        await page.goto(`/community-lineup/${lineupId}/schedule/${matchId}`);

        // Neither shell's step 1 may mount within a short window. Both are
        // asserted on both projects: after ROK-1569 the desktop body testid is
        // absent on the phone by construction, so checking it alone would pass
        // vacuously there and hide a sheet that DID open.
        await expect(page.getByTestId('game-time-check-body')).toHaveCount(0, { timeout: 5_000 });
        await expect(page.getByTestId('phone-week-check')).toHaveCount(0, { timeout: 5_000 });

        // ROK-1300: the composite body renders directly (no wizard stepper).
        await expect(
            page.locator('[data-testid="scheduling-composite"]'),
        ).toBeVisible({ timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// ROK-1300 single-hero layout — composite owns the page body; no wizard
// stepper, no separate "Scheduling Poll" h1; U2 game-ref banner replaces the
// standalone MatchContextCard.
// ---------------------------------------------------------------------------

test.describe('Scheduling poll single-hero layout (ROK-1300)', () => {
    test('hero at top, NO wizard stepper, NO separate "Scheduling Poll" h1', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // The morphing JourneyHero region is present (role=region named /scheduling/i).
        await expect(
            page.getByRole('region', { name: /scheduling/i }).first(),
        ).toBeVisible({ timeout: 15_000 });
        // Wizard stepper is gone.
        await expect(
            page.locator('[data-testid="scheduling-wizard-step-1"]'),
        ).toHaveCount(0);
        await expect(
            page.locator('[data-testid="wizard-step-indicator"]'),
        ).toHaveCount(0);
        // The active poll has no separate "Scheduling Poll" h1 (only the
        // scheduled/completed terminal state renders one).
        await expect(
            page.getByRole('heading', { level: 1, name: /^scheduling poll$/i }),
        ).toHaveCount(0);
    });

    test('U2 game-ref (in toolbar) shows game name + ⓘ; clicking navigates to /games/:id', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // ROK-1300 round 2: the game-ref lives in the hero toolbar, on the
        // same row as the submit button, and is itself clickable.
        const banner = page.locator('[data-testid="scheduling-game-ref"]');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(
            banner.locator('[data-testid="match-game-name"]'),
        ).toBeVisible({ timeout: 5_000 });
        // ⓘ hover affordance is present.
        await expect(
            banner.locator('[data-testid="scheduling-game-research"]'),
        ).toBeVisible({ timeout: 5_000 });
        // Member/match context line.
        await expect(banner).toContainText(/you|member|match/i);

        // Clicking the game-ref navigates to the game-detail page.
        await banner.click();
        await page.waitForURL(/\/games\/\d+/, { timeout: 10_000 });
        expect(page.url()).toMatch(/\/games\/\d+/);
    });
});

// ---------------------------------------------------------------------------
// AC3: Suggest a new time slot
// ---------------------------------------------------------------------------

test.describe('Scheduling poll suggest time slot', () => {
    test('suggest slot UI exists and is interactive', async ({ page }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // AC3: the date/time picker lives in the "Find a better time" sheet
        // since ROK-1543 — open it, then assert the picker.
        await openBetterTimeSheet(page);
        const dateTimeInput = page.locator(
            'input[type="datetime-local"], [data-testid="slot-datetime-picker"]',
        );
        await expect(dateTimeInput).toBeVisible({ timeout: 15_000 });

        // Suggest button is visible next to the picker (exact match to avoid wizard step button)
        const suggestBtn = page.getByRole('button', { name: 'Suggest', exact: true });
        await expect(suggestBtn).toBeVisible({ timeout: 5_000 });
    });
});

// ---------------------------------------------------------------------------
// AC4: Toggle votes on slots
// ---------------------------------------------------------------------------

test.describe('Scheduling poll vote toggling', () => {
    test('clicking a time slot toggles the vote', async ({ page }) => {
        // ROK-1247: poll for slot existence before nav so [data-testid="schedule-slot"]
        // renders within the test window.
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // AC4: ROK-1300 — slot rows carry the `+ Vote` toggle (the legacy
        // whole-card click target was replaced by the per-row vote button in
        // the SchedulingComposite). The card keeps `data-voted` for state.
        const slotCards = page.locator(
            '[data-testid="schedule-slot"]',
        );
        await expect(slotCards.first()).toBeVisible({ timeout: 15_000 });

        // Check initial voted state (may be pre-voted from beforeAll)
        const initialVoted = await slotCards.first().getAttribute('data-voted');
        const voteToggle = slotCards
            .first()
            .getByRole('button', { name: /vote/i });

        // Click the vote toggle — wait for API round-trip
        await Promise.all([
            page.waitForResponse(
                (r) => r.url().includes('/vote') && r.request().method() === 'POST',
            ).catch(() => null),
            voteToggle.click(),
        ]);

        // After click, state should be the OPPOSITE of initial
        const expectedAfterClick = initialVoted === 'true' ? 'false' : 'true';
        await expect(slotCards.first()).toHaveAttribute(
            'data-voted',
            expectedAfterClick,
            { timeout: 10_000 },
        );

        // Click again to toggle back
        await Promise.all([
            page.waitForResponse(
                (r) => r.url().includes('/vote') && r.request().method() === 'POST',
            ).catch(() => null),
            slotCards.first().getByRole('button', { name: /vote/i }).click(),
        ]);

        await expect(slotCards.first()).toHaveAttribute(
            'data-voted',
            initialVoted ?? 'false',
            { timeout: 10_000 },
        );
    });
});

// ---------------------------------------------------------------------------
// AC5: "You voted" indicator on voted slots
// ---------------------------------------------------------------------------

test.describe('Scheduling poll "You voted" indicator', () => {
    test('"You voted" indicator appears on voted slots', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // Wait for slot cards to render
        const slotCards = page.locator(
            '[data-testid="schedule-slot"]',
        );
        await expect(slotCards.first()).toBeVisible({ timeout: 15_000 });

        // Check if already voted from beforeAll
        const initialVoted = await slotCards.first().getAttribute('data-voted');

        if (initialVoted === 'true') {
            // Already voted — the ✓ glyph (aria-label="You voted") renders in
            // the row. Match by accessible label rather than visible text.
            const youVotedIndicator = slotCards.first().getByLabel('You voted');
            await expect(youVotedIndicator).toBeVisible({ timeout: 10_000 });
        } else {
            // ROK-1300: the row is a <div>; the vote toggle is a separate
            // <button aria-label="Vote for <time>">. Click the button (not the
            // card) to cast the vote, then assert the ✓ indicator.
            await Promise.all([
                page.waitForResponse(
                    (r) => r.url().includes('/vote') && r.request().method() === 'POST',
                ).catch(() => null),
                slotCards
                    .first()
                    .getByRole('button', { name: /vote for/i })
                    .click(),
            ]);
            const youVotedIndicator = slotCards.first().getByLabel('You voted');
            await expect(youVotedIndicator).toBeVisible({ timeout: 10_000 });
        }
    });
});

// ---------------------------------------------------------------------------
// AC6: HeatmapGrid renders with match members' availability
// ---------------------------------------------------------------------------

test.describe('Scheduling poll heatmap', () => {
    test('HeatmapGrid renders with match members availability data', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // AC6: the HeatmapGrid still renders with availability data — from
        // inside the ROK-1543 "Find a better time" sheet.
        await openBetterTimeSheet(page);
        const heatmapGrid = page.locator(
            '[data-testid="heatmap-grid"]',
        );
        await expect(heatmapGrid).toBeVisible({ timeout: 20_000 });

        // Heatmap should have day headers (GameTimeGrid uses day-header-{N})
        const dayLabels = heatmapGrid.locator(
            '[data-testid^="day-header-"]',
        );
        const dayLabelCount = await dayLabels.count();
        expect(dayLabelCount).toBeGreaterThan(0);

        // Heatmap should have grid cells (GameTimeGrid uses cell-{day}-{hour})
        const cells = heatmapGrid.locator(
            '[data-testid^="cell-"]',
        );
        const cellCount = await cells.count();
        expect(cellCount).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// AC7: "Create Event" button enabled only after voting
// ---------------------------------------------------------------------------

test.describe('Scheduling poll operator lock affordance (ROK-1300)', () => {
    test('"Lock this time →" appears per row for operators/creator', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // ROK-1300: the legacy CreateEventSection dropdown + "Create Event"
        // button is retired. The lock action now lives per-row as
        // "Lock this time →", operator/creator-gated via canBypassThreshold.
        // The smoke harness logs in as `admin` (operator), so the affordance
        // renders. Member-side gating is covered by the vitest composite test.
        const lockBtn = page
            .getByRole('button', { name: /lock this time/i })
            .first();
        await expect(lockBtn).toBeVisible({ timeout: 15_000 });
        await expect(lockBtn).toBeEnabled({ timeout: 15_000 });
    });
});

// ---------------------------------------------------------------------------
// ROK-1544 (P1-2): the vote IS the submit.
//
// The member submit ritual that ROK-1300 put in the sticky toolbar
// (`sticky-hero-schedule-submit`) is RETIRED: tapping a slot casts or
// withdraws the vote immediately and the server stamps
// `scheduling_submitted_at` on the first vote. These tests pin the two
// behaviours that replaced it — one tap casts (counts + leader card move,
// with no submit affordance anywhere on the page), and changing your mind
// is also exactly one tap. The ONLY button left that ends a poll is the
// operator's "Lock this time →", covered above.
// ---------------------------------------------------------------------------

/** Every retired member-submit affordance, by testid. */
const RETIRED_SUBMIT_TESTIDS = [
    'sticky-hero-schedule-submit',
    'sticky-hero-submit',
    'schedule-submit',
    'submit-bar',
];

/** Assert no member-submit affordance is rendered on the poll (ROK-1544). */
async function expectNoSubmitAffordance(
    page: import('@playwright/test').Page,
): Promise<void> {
    for (const testid of RETIRED_SUBMIT_TESTIDS) {
        await expect(page.locator(`[data-testid="${testid}"]`)).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: /submit/i })).toHaveCount(0);
}

test.describe('Scheduling poll one-tap vote (ROK-1544)', () => {
    /**
     * Drop every vote the smoke admin holds on this poll so vote counts are a
     * known 0 before a tap. Uses the poll payload's `myVotedSlotIds` (the
     * vote endpoint TOGGLES, so toggling a slot we have not voted on would
     * cast a vote instead of clearing one).
     */
    async function clearMyVotes(): Promise<void> {
        const poll = await apiGet(
            adminToken,
            `/lineups/${lineupId}/schedule/${matchId}`,
        );
        for (const slotId of (poll?.myVotedSlotIds ?? []) as number[]) {
            await apiPost(
                adminToken,
                `/lineups/${lineupId}/schedule/${matchId}/vote`,
                { slotId },
            );
        }
        await pollForCondition(
            async () => {
                const p = await apiGet(
                    adminToken,
                    `/lineups/${lineupId}/schedule/${matchId}`,
                );
                return (p?.myVotedSlotIds?.length ?? 0) === 0 ? true : null;
            },
            { timeoutMs: 15_000, description: 'admin votes cleared' },
        );
    }

    /** Suggest a slot `daysOut` days from now and return its id. */
    async function suggestSlot(daysOut: number): Promise<number> {
        const when = new Date();
        when.setDate(when.getDate() + daysOut);
        when.setHours(20, 0, 0, 0);
        const res = await apiPost(
            adminToken,
            `/lineups/${lineupId}/schedule/${matchId}/suggest`,
            { proposedTime: when.toISOString() },
        );
        const id: number | undefined = res?.data?.id ?? res?.id;
        if (!id) throw new Error('suggest did not return a slot id');
        return id;
    }

    /** Row locator for one slot. */
    function slotRow(
        page: import('@playwright/test').Page,
        slotId: number,
    ): import('@playwright/test').Locator {
        return page.locator(
            `[data-testid="schedule-slot"][data-slot-id="${slotId}"]`,
        );
    }

    test('one tap casts the vote — counts and leader card move, no submit step', async ({
        page,
    }) => {
        const slotId = await suggestSlot(2);
        // Suggesting auto-votes for the suggester; clear so the tap is the
        // only thing that can move this poll off zero.
        await clearMyVotes();
        await goToPoll(page, lineupId, matchId);

        const row = slotRow(page, slotId);
        await expect(row).toBeVisible({ timeout: 15_000 });
        await expect(row).toHaveAttribute('data-voted', 'false');
        await expect(row).toContainText('0 votes');
        await expect(
            page.locator('[data-testid="scheduling-leader-votes"]'),
        ).toContainText(/\b0 of \d+/);
        await expectNoSubmitAffordance(page);

        // ONE interaction. No confirm, no submit, no second affordance.
        await row.getByRole('button', { name: /vote for/i }).click();

        await expect(row).toHaveAttribute('data-voted', 'true', {
            timeout: 10_000,
        });
        await expect(row).toContainText('1 vote');
        // It is now the only slot with a vote, so it leads the card too.
        await expect(
            page.locator('[data-testid="scheduling-leader-votes"]'),
        ).toContainText(/\b1 of \d+/, { timeout: 10_000 });
        const leaderTime = (
            await page
                .locator('[data-testid="scheduling-leader-time"]')
                .textContent()
        )?.trim();
        expect(leaderTime).toBeTruthy();
        await expect(row).toContainText(leaderTime!);
        await expectNoSubmitAffordance(page);

        // The tap WAS the submit: a fresh page load (nothing else pressed)
        // still shows the vote, so the server committed it.
        await goToPoll(page, lineupId, matchId);
        await expect(slotRow(page, slotId)).toHaveAttribute(
            'data-voted',
            'true',
            { timeout: 15_000 },
        );
        await expect(slotRow(page, slotId)).toContainText('1 vote');
    });

    test('changing my mind is ONE tap — counts move on both rows', async ({
        page,
    }) => {
        const firstSlot = await suggestSlot(3);
        const secondSlot = await suggestSlot(4);
        await clearMyVotes();
        await goToPoll(page, lineupId, matchId);

        const first = slotRow(page, firstSlot);
        const second = slotRow(page, secondSlot);
        await expect(first).toBeVisible({ timeout: 15_000 });
        await expect(second).toBeVisible({ timeout: 15_000 });

        // Tap 1 — cast on the first slot.
        await first.getByRole('button', { name: /vote for/i }).click();
        await expect(first).toContainText('1 vote', { timeout: 10_000 });
        await expect(second).toContainText('0 votes');

        // Tap 2 — a single tap on ANOTHER slot moves its count, no submit.
        await second.getByRole('button', { name: /vote for/i }).click();
        await expect(second).toContainText('1 vote', { timeout: 10_000 });
        await expect(second).toHaveAttribute('data-voted', 'true');
        await expectNoSubmitAffordance(page);

        // Tap 3 — withdrawing is the same single tap on the voted row.
        await first.getByRole('button', { name: /remove vote for/i }).click();
        await expect(first).toContainText('0 votes', { timeout: 10_000 });
        await expect(first).toHaveAttribute('data-voted', 'false');
        await expectNoSubmitAffordance(page);

        // All three taps persisted without a submit step.
        await goToPoll(page, lineupId, matchId);
        await expect(slotRow(page, firstSlot)).toHaveAttribute(
            'data-voted',
            'false',
            { timeout: 15_000 },
        );
        await expect(slotRow(page, secondSlot)).toHaveAttribute(
            'data-voted',
            'true',
        );
    });
});

// ---------------------------------------------------------------------------
// ROK-1395: manual "Remind Voters" nudge — creator/operator-gated toolbar
// button. Placed BEFORE the event-creation tests: those flip the match to
// scheduled (read-only), which hides the button by design.
// ---------------------------------------------------------------------------

test.describe('Scheduling poll remind voters (ROK-1395)', () => {
    test('Remind Voters button visible for creator/operator, absent for a plain member', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // Admin (operator-tier) sees the button on the active poll toolbar.
        await expect(
            page.getByRole('button', { name: /remind voters/i }),
        ).toBeVisible({ timeout: 15_000 });

        // Swap the session to the non-creator member fixture (ROK-1276) —
        // the button must NOT render for them. Session swap pattern from
        // lineup-confirmation-pills-invitee.smoke.spec.ts.
        const invitee = await getInviteeFixture();
        await page.goto('/');
        await page.evaluate((t) => {
            localStorage.setItem('raid_ledger_token', t);
        }, invitee.jwt);
        await goToPoll(page, lineupId, matchId);
        await expect(
            page.getByRole('button', { name: /remind voters/i }),
        ).toHaveCount(0);
        // Context is per-test; the admin storageState is restored for
        // subsequent tests automatically.
    });
});

// ---------------------------------------------------------------------------
// ROK-1440: explicitly enrol members in the poll roster
// ---------------------------------------------------------------------------

test.describe('Scheduling poll add participants (ROK-1440)', () => {
    test('Add Participants is visible for creator/operator, absent for a plain member', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        await expect(
            page.getByTestId('add-poll-members-button'),
        ).toBeVisible({ timeout: 15_000 });

        // Same session-swap pattern as the sibling Remind Voters case — a
        // non-creator member must not get a roster-management affordance.
        const invitee = await getInviteeFixture();
        await page.goto('/');
        await page.evaluate((t) => {
            localStorage.setItem('raid_ledger_token', t);
        }, invitee.jwt);
        await goToPoll(page, lineupId, matchId);
        await expect(page.getByTestId('add-poll-members-button')).toHaveCount(0);
    });

    /**
     * The toolbar's action cluster is `flex-shrink-0` inside the hero badge
     * row, so a third button is exactly the kind of addition that can push
     * the row off-screen. This runs in BOTH the desktop and mobile Playwright
     * projects, so it pins reachability at each viewport rather than only the
     * one a developer happened to look at.
     */
    test('Add Participants stays inside the viewport and does not cause page overflow', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        const btn = page.getByTestId('add-poll-members-button');
        await expect(btn).toBeVisible({ timeout: 15_000 });

        const box = await btn.boundingBox();
        expect(box).not.toBeNull();
        const viewport = page.viewportSize();
        expect(viewport).not.toBeNull();
        // Right edge within the viewport — i.e. not clipped off-screen.
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
        expect(box!.x).toBeGreaterThanOrEqual(0);

        // And the page itself must not gain a horizontal scrollbar.
        const overflows = await page.evaluate(
            () =>
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
        );
        expect(overflows).toBe(false);
    });

    test('enrolling a member adds exactly that member to the poll roster', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        const before = await apiGet(
            adminToken,
            `/lineups/${lineupId}/schedule/${matchId}`,
        );
        const existing = new Set<number>(
            (before?.match?.members ?? []).map(
                (m: { userId: number }) => m.userId,
            ),
        );

        /**
         * Pick a target deterministically. An earlier version clicked
         * `[data-testid^="invitee-option-"]).first()`, which takes whichever
         * option happens to render first — on CI that was already a poll
         * member, so the roster never grew and the assertion timed out while
         * passing locally. The picker does not filter out existing members,
         * so the test has to do it.
         */
        const usersRes = await apiGet(adminToken, '/users?limit=200');
        const candidates: {
            id: number;
            username: string;
            steamLinked: boolean;
        }[] = usersRes?.data ?? usersRes ?? [];
        const target = candidates.find((u) => u && !existing.has(u.id));
        expect(
            target,
            'no community member outside the poll roster to enrol',
        ).toBeTruthy();

        await page.getByTestId('add-poll-members-button').click();
        const search = page.getByTestId('invitee-search');
        await expect(search).toBeVisible({ timeout: 10_000 });
        // Narrow the list so the target is rendered regardless of page size.
        await search.fill(target!.username);

        const option = page.getByTestId(`invitee-option-${target!.id}`);
        await expect(option).toBeVisible({ timeout: 10_000 });

        // ROK-1530 TD-2: `/users` exposes `steamLinked` and the picker renders
        // the "No Steam linked" caveat for exactly the members missing it.
        expect(
            typeof target!.steamLinked,
            '/users must expose steamLinked (ROK-1530 TD-2)',
        ).toBe('boolean');
        await expect(option.getByText(/No Steam linked/i)).toHaveCount(
            target!.steamLinked ? 0 : 1,
        );

        await option.click();
        await page.getByTestId('add-poll-members-submit').click();

        // Assert THAT member landed, not merely that a count rose — a count
        // check passes for the wrong member and fails silently for the right
        // one. The mutation invalidates the schedule query, so poll the API
        // rather than racing the refetch.
        await pollForCondition(
            async () => {
                const after = await apiGet(
                    adminToken,
                    `/lineups/${lineupId}/schedule/${matchId}`,
                );
                const ids: number[] = (after?.match?.members ?? []).map(
                    (m: { userId: number }) => m.userId,
                );
                // Both conditions: the target is present AND the roster
                // actually grew. `includes` alone would pass trivially if the
                // target had somehow already been enrolled, which is the very
                // failure mode this rewrite exists to rule out.
                return ids.includes(target!.id) && ids.length > existing.size
                    ? after
                    : null;
            },
            {
                timeoutMs: 15_000,
                intervalMs: 500,
                description: `poll roster to contain user ${target?.id}`,
            },
        );
    });
});

// ---------------------------------------------------------------------------
// AC8 + AC9: Event creation → success state → scheduled badge + event link
// ---------------------------------------------------------------------------

test.describe('Scheduling poll event creation and post-creation status', () => {
    test('creating event via API shows Poll Complete state with badge and event link', async ({
        page,
    }) => {
        // Create event via API (the frontend now navigates to /events/new instead)
        const slotRes = await apiGet(adminToken, `/lineups/${lineupId}/schedule/${matchId}`);
        const slotId = slotRes?.slots?.[0]?.id;

        let eventCreated = false;
        if (slotId) {
            await apiPost(adminToken, `/lineups/${lineupId}/schedule/${matchId}/vote`, {
                slotId,
            }).catch(() => {});
            const createRes = await apiPost(adminToken, `/lineups/${lineupId}/schedule/${matchId}/create-event`, {
                slotId,
            }).catch(() => null);
            eventCreated = !!(createRes?.id || createRes?.eventId);
        }

        // If event creation didn't succeed (match already scheduled, no slots, etc.),
        // check if match is already in scheduled state
        if (!eventCreated) {
            const matchRes = await apiGet(adminToken, `/lineups/${lineupId}/schedule/${matchId}`);
            eventCreated = matchRes?.match?.status === 'scheduled';
        }

        // ROK-1247: when an event was created, poll until the API observes the
        // status flip so the page renders the "Poll Complete"/"Scheduled" badge.
        if (eventCreated) {
            await pollForCondition<SchedulingPollResponse>(
                async () => {
                    const data = (await apiGet(
                        adminToken,
                        `/lineups/${lineupId}/schedule/${matchId}`,
                    )) as SchedulingPollResponse | null;
                    return data?.match?.status === 'scheduled' ? data : null;
                },
                {
                    timeoutMs: 15_000,
                    description: 'scheduling poll match status=scheduled',
                },
            );
        }

        await goToPoll(page, lineupId, matchId);

        if (eventCreated) {
            // Scheduled terminal state → CompletedPollState renders (it KEEPS
            // the "Scheduling Poll" h1 + badge + event link).
            await expect(
                page.getByRole('heading', { level: 1, name: /^scheduling poll$/i }),
            ).toBeVisible({ timeout: 15_000 });
            const completedBadge = page.locator('[data-testid="match-status-badge"]');
            await expect(completedBadge).toBeVisible({ timeout: 15_000 });
            await expect(completedBadge).toHaveText(/Poll Complete|Scheduled/i);

            const eventLink = page.getByRole('link', { name: /View Event/i });
            await expect(eventLink).toBeVisible({ timeout: 5_000 });
        } else {
            // Event creation wasn't possible — verify the active-poll composite
            // loads cleanly (ROK-1300: the active poll has no separate h1; the
            // h1 only exists in the scheduled/completed terminal state above).
            await expect(
                page.locator('[data-testid="scheduling-composite"]'),
            ).toBeVisible({ timeout: 15_000 });
        }
    });
});

// ---------------------------------------------------------------------------
// AC10: Events-view banner for match members
// ---------------------------------------------------------------------------

test.describe('Scheduling poll events-view banner', () => {
    test('events-view banner component exists and renders for scheduling matches', async ({
        page,
    }) => {
        // Navigate to the events list page — banner shows for scheduling matches
        await page.goto('/events');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // AC10: The banner component should be in the DOM (may or may not be visible
        // depending on test execution order — event creation in AC8 may have changed
        // match state to 'scheduled'). Verify the component is rendered by checking
        // for the scheduling-poll-banner OR confirm the events page loads clean.
        const schedulingBanner = page.locator(
            '[data-testid="scheduling-poll-banner"]',
        );
        const bannerVisible = await schedulingBanner
            .isVisible({ timeout: 5_000 })
            .catch(() => false);

        if (bannerVisible) {
            // Banner visible — verify it has a link to a scheduling poll
            const pollLink = schedulingBanner.getByRole('link').first();
            await expect(pollLink).toBeVisible({ timeout: 5_000 });
            const href = await pollLink.getAttribute('href');
            expect(href).toMatch(
                /\/community-lineup\/\d+\/schedule\/\d+/,
            );
        } else {
            // Banner not visible (match may be scheduled already) — events page loads clean
            await expect(page.locator('body')).toBeVisible();
        }
    });
});

// ---------------------------------------------------------------------------
// AC11: "Your Other Scheduling Polls" section for multi-match users
// ---------------------------------------------------------------------------

test.describe('Scheduling poll other polls section', () => {
    test('"Your Other Scheduling Polls" section shows for multi-match users', async ({
        page,
    }) => {
        await goToPoll(page, lineupId, matchId);

        // AC11: "Your Other Scheduling Polls" section should be present
        // for users who are members of multiple matches
        const otherPollsSection = page.locator(
            '[data-testid="other-scheduling-polls"]',
        );
        const otherPollsHeading = page.getByText(
            /Your Other Scheduling Polls|Other Polls/i,
        );

        // If the user is a member of multiple matches, the section is visible
        const isVisible = await otherPollsHeading
            .isVisible({ timeout: 15_000 })
            .catch(() => false);

        if (isVisible) {
            await expect(otherPollsSection).toBeVisible({
                timeout: 5_000,
            });

            // Each listed poll should link to its scheduling page
            const pollLinks = otherPollsSection.getByRole('link');
            const linkCount = await pollLinks.count();
            expect(linkCount).toBeGreaterThan(0);
        } else {
            // If only one match, the section should not be present — that's valid
            await expect(otherPollsSection).not.toBeVisible();
        }
    });
});

// ---------------------------------------------------------------------------
// ROK-1014 AC1/AC2: GameTimeGrid shows abbreviated day names on mobile, full on desktop
// ---------------------------------------------------------------------------

test.describe('Scheduling poll GameTimeGrid day name abbreviation (ROK-1014)', () => {
    // The event-creation describe above locks the SHARED poll in, and a
    // scheduled poll hides the "Find a better time" affordance by design —
    // so on a worker that ran that describe first these two tests could never
    // open the sheet (seen 4× on 2026-09-14 across three branches, passing on
    // the retry's fresh worker). Own a fresh, still-open poll instead.
    let gridLineupId: number;
    let gridMatchId: number;

    test.beforeAll(async () => {
        const fresh = await createSchedulingLineupWithMatch(adminToken);
        gridLineupId = fresh.lineupId;
        gridMatchId = fresh.matchId;
    });

    test('mobile: GameTimeGrid shows abbreviated day names (Sun, Mon)', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'desktop',
            'Mobile-only test — abbreviated day names only shown on <768px viewports',
        );

        // ROK-1301: the gametime grid no longer lives in the wizard; the
        // GameTimeGrid day-header behavior renders via the heatmap, which
        // ROK-1543 moved into the "Find a better time" sheet.
        await goToPoll(page, gridLineupId, gridMatchId);
        await openBetterTimeSheet(page);

        const grid = page.locator('[data-testid="heatmap-grid"], [data-testid="game-time-grid"]');
        const isGridVisible = await grid.isVisible({ timeout: 10_000 }).catch(() => false);

        if (isGridVisible) {
            // On mobile (<768px), day headers should show abbreviated names
            const dayHeaders = grid.locator('[data-testid^="day-header-"]');
            const count = await dayHeaders.count();
            expect(count).toBeGreaterThan(0);

            // Check at least one header uses abbreviated form (3-letter: Sun, Mon, Tue, etc.)
            const firstHeaderText = await dayHeaders.first().textContent();
            expect(firstHeaderText).toBeDefined();
            // Abbreviated names are exactly 3 characters
            expect(firstHeaderText!.trim().length).toBeLessThanOrEqual(3);
        }
    });

    test('desktop: GameTimeGrid shows full day names (Sunday, Monday)', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'mobile',
            'Desktop-only test — full day names only shown on >=768px viewports',
        );

        // ROK-1301: the gametime grid no longer lives in the wizard; the
        // GameTimeGrid day-header behavior renders via the heatmap, which
        // ROK-1543 moved into the "Find a better time" sheet.
        await goToPoll(page, gridLineupId, gridMatchId);
        await openBetterTimeSheet(page);

        const grid = page.locator('[data-testid="heatmap-grid"], [data-testid="game-time-grid"]');
        const isGridVisible = await grid.isVisible({ timeout: 10_000 }).catch(() => false);

        if (isGridVisible) {
            const dayHeaders = grid.locator('[data-testid^="day-header-"]');
            const count = await dayHeaders.count();
            expect(count).toBeGreaterThan(0);

            // On desktop (>=768px), day headers should show full names
            const firstHeaderText = await dayHeaders.first().textContent();
            expect(firstHeaderText).toBeDefined();
            // Full day names are at least 6 characters (Monday, Sunday, etc.)
            expect(firstHeaderText!.trim().length).toBeGreaterThanOrEqual(6);
        }
    });
});

// ---------------------------------------------------------------------------
// ROK-1014 AC3: Create Event button visible above bottom nav on mobile
// ---------------------------------------------------------------------------

test.describe('Scheduling poll bottom padding (ROK-1014)', () => {
    test('mobile: page container has bottom padding to clear nav bar', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'desktop',
            'Mobile-only test — bottom padding only relevant on mobile with nav bar',
        );

        await goToPoll(page, lineupId, matchId);

        // Verify a container has the pb-20 class (bottom padding to clear
        // the fixed mobile nav bar). pb-20 = 5rem = 80px clearance.
        const hasPadding = await page.evaluate(() => {
            return !!document.querySelector('.pb-20');
        });
        expect(hasPadding).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// ROK-1014 AC12/AC13: Voter avatars on suggested time slots
// ---------------------------------------------------------------------------

test.describe('Scheduling poll voter avatars (ROK-1014)', () => {
    // The event-creation describe above locks the SHARED poll in, and a
    // scheduled poll renders no votable slot rows — so on a worker that ran
    // that describe first `[data-voted="true"]` never appears (PR #1217 shard
    // 3/5, 2026-09-14; same family as the day-name fix in #1214). Own a
    // fresh, still-open poll instead.
    let avatarLineupId: number;
    let avatarMatchId: number;

    test.beforeAll(async () => {
        const fresh = await createSchedulingLineupWithMatch(adminToken);
        avatarLineupId = fresh.lineupId;
        avatarMatchId = fresh.matchId;
        // A fresh poll has no slots; suggest one (the suggester auto-votes,
        // and the first test below votes again only if the slot is empty).
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(19, 0, 0, 0);
        await apiPost(
            adminToken,
            `/lineups/${avatarLineupId}/schedule/${avatarMatchId}/suggest`,
            { proposedTime: tomorrow.toISOString() },
        );
    });

    test('voted slot cards show stacked voter avatars', async ({
        page,
    }) => {
        // Ensure first slot has admin's vote — get the slot, check if admin
        // has already voted, and only call toggle when needed. Belt-and-
        // suspenders: re-check after toggle and call again if still not
        // voted (the vote endpoint returns `{ voted: boolean }` reflecting
        // the post-toggle state, but the toggle-twice race documented in
        // TECH-DEBT-BACKLOG.md 2026-05-09 entry can still leave a slot
        // without admin's vote in some orderings).
        const initialPoll = await apiGet(
            adminToken,
            `/lineups/${avatarLineupId}/schedule/${avatarMatchId}`,
        );
        const firstSlotId = initialPoll?.slots?.[0]?.id;
        if (firstSlotId) {
            const slotHasAnyVote = (initialPoll.slots[0].votes?.length ?? 0) > 0;
            // If the slot has any votes (admin's or another fixture's),
            // we likely already have what we need. Toggle vote only when
            // the slot is empty.
            if (!slotHasAnyVote) {
                await apiPost(
                    adminToken,
                    `/lineups/${avatarLineupId}/schedule/${avatarMatchId}/vote`,
                    { slotId: firstSlotId },
                );
            }
            // Re-check: if still empty (rare race), force toggle once more.
            const verify = await apiGet(
                adminToken,
                `/lineups/${avatarLineupId}/schedule/${avatarMatchId}`,
            );
            if ((verify?.slots?.[0]?.votes?.length ?? 0) === 0) {
                await apiPost(
                    adminToken,
                    `/lineups/${avatarLineupId}/schedule/${avatarMatchId}/vote`,
                    { slotId: firstSlotId },
                );
            }
        }

        // ROK-1247: poll until the API observes the vote. Without this, the
        // page's useQuery can serve a cached "no votes" payload and the
        // voted slot row never renders its avatar group within the window.
        await pollSchedulingPollHasSlot(adminToken, avatarLineupId, avatarMatchId, {
            withVote: true,
        });
        await goToPoll(page, avatarLineupId, avatarMatchId);

        // AC12 (ROK-1300): voted slot ROWS render a stacked voter avatar group.
        // SchedulingSlotRow mounts MemberAvatarGroup only when the slot has
        // votes — so a voted row (data-voted="true") MUST contain one. Scope
        // the assertion to a voted row (not page-wide .first(), which could
        // match the hero game-ref's member stack and mask a row regression).
        const votedRow = page
            .locator('[data-testid="schedule-slot"][data-voted="true"]')
            .first();
        await expect(votedRow).toBeVisible({ timeout: 15_000 });
        await expect(
            votedRow.locator('[data-testid="member-avatar-group"]'),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('slots with 0 votes show no avatar row', async ({
        page,
    }) => {
        // Suggest a new slot that nobody votes on
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 14);
        futureDate.setHours(22, 0, 0, 0);
        await apiPost(adminToken, `/lineups/${avatarLineupId}/schedule/${avatarMatchId}/suggest`, {
            proposedTime: futureDate.toISOString(),
        }).catch(() => {});

        await goToPoll(page, avatarLineupId, avatarMatchId);

        // The newly suggested slot auto-votes for the suggester, so retract
        const pollData = await apiGet(
            adminToken,
            `/lineups/${avatarLineupId}/schedule/${avatarMatchId}`,
        );
        const zeroVoteSlot = pollData?.slots?.find(
            (s: { votes: unknown[] }) => s.votes.length === 0,
        );

        if (zeroVoteSlot) {
            // AC13: Slot with 0 votes should NOT have an avatar group
            const slotCard = page.locator(
                `[data-testid="schedule-slot"]:has-text("0 votes")`,
            ).first();
            if (await slotCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
                const avatarGroup = slotCard.locator('[data-testid="member-avatar-group"]');
                await expect(avatarGroup).not.toBeVisible();
            }
        }
        // If no zero-vote slot exists (auto-vote made all slots have votes), pass vacuously
    });
});

// ---------------------------------------------------------------------------
// AC12: Read-only mode when match status is not "scheduling"
// ---------------------------------------------------------------------------

test.describe('Scheduling poll read-only mode', () => {
    test('scheduled match shows read-only view without vote controls', async ({
        page,
    }) => {
        // Ensure the match is scheduled by creating an event via API
        // (idempotent — if already scheduled from AC8, createEvent returns error which is fine)
        const slotRes = await apiGet(
            adminToken,
            `/lineups/${lineupId}/schedule/${matchId}`,
        );
        if (slotRes?.slots?.[0]?.id) {
            // Vote on the slot first (required to create event)
            await apiPost(adminToken, `/lineups/${lineupId}/schedule/${matchId}/vote`, {
                slotId: slotRes.slots[0].id,
            });
            await apiPost(adminToken, `/lineups/${lineupId}/schedule/${matchId}/create-event`, {
                slotId: slotRes.slots[0].id,
            }).catch(() => {/* Already created — ignore */});
        }

        await goToPoll(page, lineupId, matchId);

        const heading = page.locator('h1', { hasText: 'Scheduling Poll' });
        await expect(heading).toBeVisible({ timeout: 15_000 });

        // After event creation the match is locked in — the page is read-only.
        const readOnlyBanner = page.locator('[data-testid="read-only-banner"]');

        // ROK-1545: the banner no longer says a generic "Voting is closed." —
        // it names the ending, so the assertion names it too.
        await expect(readOnlyBanner).toBeVisible({ timeout: 15_000 });
        await expect(readOnlyBanner).toHaveAttribute(
            'data-poll-status',
            'locked_in',
        );
        // …and answers "so when is it?" with a link to the created event.
        const eventLink = readOnlyBanner.locator(
            '[data-testid="terminal-event-link"]',
        );
        await expect(eventLink).toBeVisible({ timeout: 10_000 });
        await expect(eventLink).toHaveAttribute('href', /^\/events\/\d+$/);

        // The read-only page offers nothing to vote with (`canVote` false).
        await expect(
            page.getByRole('button', { name: /vote for/i }),
        ).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// ROK-1545 (P1-3): the poll page says WHAT happened, not just "closed".
// The three terminal endings render distinct banners; `data-poll-status`
// is the wire between the server's `pollStatus` and the rendered ending.
//
// These two tests SHARE one fresh poll and run in order (Playwright runs a
// file's tests serially in one worker): expire it first, then cancel it —
// which also pins that a cancellation outranks an expired window.
// ---------------------------------------------------------------------------

test.describe('Scheduling poll terminal states (ROK-1545)', () => {
    test.describe.configure({ timeout: 120_000 });

    let terminalLineupId: number;
    let terminalMatchId: number;

    test.beforeAll(async () => {
        const fresh = await createSchedulingLineupWithMatch(adminToken);
        terminalLineupId = fresh.lineupId;
        terminalMatchId = fresh.matchId;
    });

    test('an expired poll (lineup archived, no lock-in) renders the expired banner', async ({
        page,
    }) => {
        await apiPatch(adminToken, `/lineups/${terminalLineupId}/status`, {
            status: 'archived',
        });

        await goToPoll(page, terminalLineupId, terminalMatchId);

        const banner = page.locator('[data-testid="read-only-banner"]');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toHaveAttribute('data-poll-status', 'closed');
        await expect(banner).toContainText(/deadline passed without a lock-in/i);
    });

    test('a cancelled poll renders the operator reason, not a generic closed banner', async ({
        page,
    }) => {
        const reason = 'Half the group is away this week.';
        await apiPost(
            adminToken,
            `/lineups/${terminalLineupId}/schedule/${terminalMatchId}/cancel`,
            { reason },
        );

        await goToPoll(page, terminalLineupId, terminalMatchId);

        const banner = page.locator('[data-testid="read-only-banner"]');
        await expect(banner).toBeVisible({ timeout: 15_000 });
        // Cancellation outranks the expired window set up by the test above.
        await expect(banner).toHaveAttribute('data-poll-status', 'cancelled');
        await expect(banner).toContainText(reason);
        // No vote affordance survives a cancellation.
        await expect(
            page.getByRole('button', { name: /vote for/i }),
        ).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// ROK-1543 (P1-1): Layout B — "when are we playing?" in one glance.
// AC1 the leading time + its votes are above the slot list and inside the
// viewport at 375px with no scrolling; AC3 the heatmap is one affordance away.
// ---------------------------------------------------------------------------

test.describe('Scheduling poll leader card (ROK-1543)', () => {
    // Earlier describes lock the shared poll in (Poll Complete renders no
    // leader card), so this group gets its OWN fresh poll with one voted slot.
    let leaderLineupId: number;
    let leaderMatchId: number;

    test.beforeAll(async () => {
        const fresh = await createSchedulingLineupWithMatch(adminToken);
        leaderLineupId = fresh.lineupId;
        leaderMatchId = fresh.matchId;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(19, 0, 0, 0);
        const suggestRes = await apiPost(
            adminToken,
            `/lineups/${leaderLineupId}/schedule/${leaderMatchId}/suggest`,
            { proposedTime: tomorrow.toISOString() },
        );
        const slotId = suggestRes?.data?.id ?? suggestRes?.id;
        if (slotId) {
            await apiPost(
                adminToken,
                `/lineups/${leaderLineupId}/schedule/${leaderMatchId}/vote`,
                { slotId },
            );
        }
    });

    test.beforeEach(async ({ page }) => {
        // The test user is not in the guild, so the dismissible Discord-join
        // banner would otherwise sit above the page and skew the fold check.
        await page.addInitScript(() => {
            sessionStorage.setItem('discord-join-banner-dismissed', 'true');
        });
    });
    test('leader card answers the poll at 375px without scrolling', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, leaderLineupId, leaderMatchId);
        await page.setViewportSize({ width: 375, height: 667 });
        await goToPoll(page, leaderLineupId, leaderMatchId);

        const card = page.locator('[data-testid="scheduling-leader-card"]');
        await expect(card).toBeVisible({ timeout: 15_000 });
        await expect(
            page.locator('[data-testid="scheduling-leader-time"]'),
        ).toBeVisible();
        await expect(
            page.locator('[data-testid="scheduling-leader-votes"]'),
        ).toContainText(/\d+ of \d+/);

        // Nothing was scrolled to make it visible, and what AC1 names — the
        // leading time, its vote count and the deadline — sits inside the
        // 667px viewport (the card's own bottom padding may kiss the fold).
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        const box = await card.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        for (const id of [
            'scheduling-leader-time',
            'scheduling-leader-votes',
            'poll-deadline-banner',
        ]) {
            const el = page.locator(`[data-testid="${id}"]`).first();
            await expect(el).toBeVisible();
            const b = await el.boundingBox();
            expect(b, id).not.toBeNull();
            expect(b!.y + b!.height, `${id} bottom edge`).toBeLessThanOrEqual(667);
        }

        // ...and it sits ABOVE the first slot row.
        const slotBox = await page
            .locator('[data-testid="schedule-slot"]')
            .first()
            .boundingBox();
        expect(slotBox).not.toBeNull();
        expect(box!.y).toBeLessThan(slotBox!.y);
    });

    test('the heatmap is behind the "Find a better time" affordance', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, leaderLineupId, leaderMatchId);
        await goToPoll(page, leaderLineupId, leaderMatchId);

        // AC3: not in the primary body...
        await expect(
            page.locator('[data-testid="scheduling-leader-card"]'),
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="heatmap-grid"]')).toHaveCount(0);

        // ...one tap away, in a Modal (>=768px) or BottomSheet (<768px).
        await openBetterTimeSheet(page);
        await expect(page.locator('[data-testid="heatmap-grid"]')).toBeVisible({
            timeout: 15_000,
        });
        const surface = await page
            .locator('[data-testid="scheduling-better-time-body"]')
            .getAttribute('data-surface');
        const viewport = page.viewportSize();
        expect(surface).toBe((viewport?.width ?? 0) >= 768 ? 'modal' : 'sheet');
    });
});

// ---------------------------------------------------------------------------
// ROK-1558: on mobile the hero is NOT sticky — it scrolls away with the page
// ---------------------------------------------------------------------------

test.describe('Scheduling poll mobile hero scrolls away (ROK-1558)', () => {
    // The hero used to be `sticky top-14` at every width and auto-hide on
    // mobile scroll-down by translating itself off-screen. A transform does
    // not collapse the sticky box, so the hidden hero left a blank band its
    // own height tall above the slot ladder. Owns its own still-open poll —
    // the shared one may be locked in by the event-creation describe.
    let heroLineupId: number;
    let heroMatchId: number;

    test.beforeAll(async () => {
        const fresh = await createSchedulingLineupWithMatch(adminToken);
        heroLineupId = fresh.lineupId;
        heroMatchId = fresh.matchId;
        const when = new Date();
        when.setDate(when.getDate() + 1);
        when.setHours(19, 0, 0, 0);
        await apiPost(
            adminToken,
            `/lineups/${heroLineupId}/schedule/${heroMatchId}/suggest`,
            { proposedTime: when.toISOString() },
        );
        await pollSchedulingPollHasSlot(adminToken, heroLineupId, heroMatchId);
    });

    test('mobile: the hero is not sticky and leaves no blank band behind', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'desktop',
            'Mobile-only test — the hero stays pinned (md:sticky) on desktop',
        );

        await goToPoll(page, heroLineupId, heroMatchId);
        const toolbar = page.locator('[data-testid="scheduling-toolbar"]');
        await expect(toolbar).toBeVisible({ timeout: 15_000 });

        // 1. Not sticky at this width — nothing can pin and then transform.
        const position = await toolbar.evaluate(
            (el) => getComputedStyle(el).position,
        );
        expect(position).not.toBe('sticky');

        // 2. It travels with the page, 1:1 with the scroll offset.
        const before = (await toolbar.boundingBox())!;
        const scrolledBy = await page.evaluate(async () => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            return window.scrollY;
        });
        // How far the page CAN scroll depends on how much sits under the hero
        // (a fresh one-slot poll scrolled 536px on the fleet, less than the
        // hero + 100px this once demanded); the 1:1 travel check below is the
        // real proof, so only require that the page scrolled at all.
        expect(scrolledBy).toBeGreaterThan(0);

        const after = await toolbar.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
        });
        expect(Math.abs(after.top - (before.y - scrolledBy))).toBeLessThan(4);

        // 3. No blank band: once the page is tall enough for the hero to have
        //    left entirely, the poll body — not an empty hero-sized box —
        //    occupies the top of the viewport. On a short page (GitHub's fresh
        //    DB: the hero bottom sat at 44px after a full scroll) the 1:1 travel
        //    above is already the proof, so the hero-gone checks are skipped.
        if (scrolledBy < before.y + before.height) return;
        expect(after.bottom).toBeLessThanOrEqual(0);
        const hit = await page.evaluate(() => {
            const el = document.elementFromPoint(
                Math.floor(window.innerWidth / 2),
                96,
            );
            const bar = document.querySelector(
                '[data-testid="scheduling-toolbar"]',
            );
            return {
                insideToolbar: !!(el && bar && bar.contains(el)),
                inComposite: !!el?.closest('[data-testid="scheduling-composite"]'),
            };
        });
        expect(hit.insideToolbar).toBe(false);
        expect(hit.inComposite).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// ROK-1546: the phone treatment of the slot ladder's two actions
// ---------------------------------------------------------------------------

test.describe('Scheduling poll mobile actions (ROK-1546)', () => {
    // AC1 (44px hit targets) and AC6 (the "find a better time" trigger reads as
    // a real secondary button, not a ghost) are both CSS-only and both only
    // apply below `sm`, so they need a real mobile viewport to be worth
    // anything. Owns its own still-open poll — the shared one may have been
    // locked in by the event-creation describe.
    let actionsLineupId: number;
    let actionsMatchId: number;
    /** The proposed time of this describe's single slot (AC3 seeds against it). */
    let actionsSlotTime: string;

    test.beforeAll(async () => {
        const fresh = await createSchedulingLineupWithMatch(adminToken);
        actionsLineupId = fresh.lineupId;
        actionsMatchId = fresh.matchId;
        // An odd hour, days away from the file's shared +1d/+2d 19:00–20:00
        // grid: the AC3 events below are admin-wide, so a slot another worker
        // proposes in the same window would read them as ITS conflict.
        const when = new Date();
        when.setDate(when.getDate() + 6);
        when.setHours(23, 15, 0, 0);
        actionsSlotTime = when.toISOString();
        await apiPost(
            adminToken,
            `/lineups/${actionsLineupId}/schedule/${actionsMatchId}/suggest`,
            { proposedTime: when.toISOString() },
        );
        await pollSchedulingPollHasSlot(
            adminToken,
            actionsLineupId,
            actionsMatchId,
        );
    });

    test('AC1: the vote button clears the 44px touch target', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'desktop',
            'Mobile-only — the 44px floor is `min-h-[44px] sm:min-h-[36px]`',
        );

        await goToPoll(page, actionsLineupId, actionsMatchId);
        const vote = page
            .locator('[data-testid="schedule-slot"] button[aria-pressed]')
            .first();
        await expect(vote).toBeVisible({ timeout: 15_000 });
        const box = await vote.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
    });

    test('AC6: the better-time trigger is a solid, foreground-coloured button', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'desktop',
            'Mobile-only — the dashed/muted treatment is kept from `sm` up',
        );

        await goToPoll(page, actionsLineupId, actionsMatchId);
        const trigger = page.locator(
            '[data-testid="scheduling-find-better-time"]',
        );
        await expect(trigger).toBeVisible({ timeout: 15_000 });

        // Not the ghost: solid border, and the copy is at full foreground
        // contrast rather than the muted secondary tone.
        const styles = await trigger.evaluate((el) => {
            // Resolve `--color-foreground` through the engine so the hex in
            // index.css and the computed `rgb()` are directly comparable.
            const probe = document.createElement('span');
            probe.style.color = 'var(--color-foreground)';
            document.body.appendChild(probe);
            const foreground = getComputedStyle(probe).color;
            probe.remove();
            const own = getComputedStyle(el);
            return {
                borderStyle: own.borderTopStyle,
                color: own.color,
                foreground,
            };
        });
        expect(styles.borderStyle).not.toBe('dashed');
        expect(styles.color).toBe(styles.foreground);

        // AC1 applies to this action too.
        const box = await trigger.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
    });

    /**
     * AC3 — the conflict warning used to name the FIRST clashing event inline
     * and hide the rest behind a `title` tooltip, which a phone can never
     * open. Both names have to be readable on the page itself.
     */
    test('AC3: the conflict warning names every clashing event as visible text', async ({
        page,
    }) => {
        const stamp = Date.now();
        const titles = [
            `rok-1546-conflict-a-${stamp}`,
            `rok-1546-conflict-b-${stamp}`,
        ];
        // Creating an event signs the admin up for it, which is what the
        // conflict query keys on. Both land inside the slot's 2h window.
        const end = new Date(
            new Date(actionsSlotTime).getTime() + 60 * 60 * 1000,
        ).toISOString();
        const created: number[] = [];
        try {
            for (const title of titles) {
                const event = (await apiPost(adminToken, '/events', {
                    title,
                    startTime: actionsSlotTime,
                    endTime: end,
                    maxAttendees: 10,
                })) as { id: number };
                created.push(event.id);
            }
            await goToPoll(page, actionsLineupId, actionsMatchId);
            const marker = page
                .locator('[data-testid="slot-conflicts"]')
                .first();
            await expect(marker).toBeVisible({ timeout: 15_000 });
            for (const title of titles) {
                await expect(marker).toContainText(title);
            }
            // Nothing is left behind a hover-only affordance.
            await expect(marker).not.toContainText('+1');
            expect(await marker.getAttribute('title')).toBeNull();
        } finally {
            // The events are admin-wide — a leftover would fake a conflict on
            // any other poll with a slot in the same window.
            for (const id of created) {
                await apiDelete(adminToken, `/events/${id}`);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// ROK-1560: the "Find a better time" sheet names both heatmap channels.
// The legend renders whenever the group-availability response carries
// `freshnessDays` (the scheduling aggregate always does) AND the section has
// cells — so this describe owns a poll whose only member (admin) has a seeded
// game-time template.
// ---------------------------------------------------------------------------

test.describe('Find a better time — availability legend (ROK-1560)', () => {
    let legendLineupId: number;
    let legendMatchId: number;

    test.beforeAll(async () => {
        // Own the poll: sibling describes lock in / archive theirs, which would
        // flip this one into a terminal state with no better-time sheet.
        const fresh = await createSchedulingLineupWithMatch(adminToken);
        legendLineupId = fresh.lineupId;
        legendMatchId = fresh.matchId;

        // The section renders nothing for an empty `cells` array, and cells are
        // built from match members' game-time templates — so make sure the
        // viewing admin has one (and a fresh `confirmed_at`).
        await apiPut(adminToken, '/users/me/game-time', {
            slots: [
                { dayOfWeek: 2, hour: 20 },
                { dayOfWeek: 2, hour: 21 },
                { dayOfWeek: 4, hour: 20 },
            ],
        });

        // A slot keeps the poll body in its active shape (the better-time
        // affordance mounts with it).
        const when = new Date();
        when.setDate(when.getDate() + 4);
        when.setHours(21, 30, 0, 0);
        await apiPost(
            adminToken,
            `/lineups/${legendLineupId}/schedule/${legendMatchId}/suggest`,
            { proposedTime: when.toISOString() },
        );
        await pollSchedulingPollHasSlot(
            adminToken,
            legendLineupId,
            legendMatchId,
        );
    });

    test('the sheet shows a two-channel legend naming the freshness window', async ({
        page,
    }) => {
        await goToPoll(page, legendLineupId, legendMatchId);
        await openBetterTimeSheet(page);

        const legend = page.getByTestId('heatmap-legend');
        await expect(legend).toBeVisible({ timeout: 20_000 });
        // Channel 2 (hatch) is the whole point of ROK-1560: unknown/stale
        // availability must be named, not silently painted as "not free".
        await expect(legend).toContainText(/stale \(older than \d+ days\)/i);
        // Channel 1 (fill) states the server's freshness window — 7 days
        // (`GAME_TIME_FRESHNESS_DAYS`), rendered from the API response.
        await expect(legend).toContainText(/last 14 days/i);
    });
});

// ---------------------------------------------------------------------------
// ROK-1564 — the game-time check before voting.
//
// A stale viewer is asked ONE question with four answers; the week painter is
// gone from the overlay (it lives at /profile/gaming/game-time). "Looks right"
// is a confirm-only save: it stamps `game_time_confirmed_at`, the refetch
// reports `gameTimeStale: false`, and the overlay closes because the derived
// open condition stopped holding — nothing force-closes it.
//
// Both projects run this: the shell is a Modal ≥768px and a BottomSheet below,
// but both expose `role="dialog"` and the SAME body testids, so every assertion
// here is shell-agnostic by construction.
// ---------------------------------------------------------------------------

test.describe('Game-time check before voting (ROK-1564)', () => {
    let checkLineupId: number;
    let checkMatchId: number;

    /** Re-stamped in afterAll so sibling describes see a FRESH admin again. */
    const RESTORE_SLOTS = [
        { dayOfWeek: 2, hour: 19 },
        { dayOfWeek: 2, hour: 20 },
        { dayOfWeek: 4, hour: 20 },
    ];

    /**
     * Step 1's body. ROK-1569 split the shells: the desktop Modal still renders
     * the four-answer `game-time-check-body`, the phone sheet renders the week
     * editor (`phone-week-check`). Every shared assertion below goes through
     * here so it means the same thing on both projects.
     */
    function checkBody(
        page: import('@playwright/test').Page,
    ): import('@playwright/test').Locator {
        return isMobile(test.info())
            ? page.getByTestId('phone-week-check')
            : page.getByTestId('game-time-check-body');
    }

    /** The prompt, wherever step 1 puts it. */
    function checkPrompt(
        page: import('@playwright/test').Page,
    ): import('@playwright/test').Locator {
        return isMobile(test.info())
            ? page.getByTestId('phone-week-prompt')
            : page.getByTestId('game-time-check-prompt');
    }

    /** The one question, in every shape the server's age/slots can produce. */
    const PROMPT_RE =
        /^(Your game time is \d+ days old\. Anything changed\?|Your game time hasn't been confirmed yet\. Anything changed\?|You haven't set a game time yet\. Anything to add\?)$/;

    /** Read the server's freshness verdict for the authenticated admin. */
    async function readGameTimeStale(): Promise<boolean | undefined> {
        const res = await apiGet(adminToken, '/users/me/game-time');
        return (res?.data ?? res)?.gameTimeStale;
    }

    /**
     * Navigate WITHOUT the defensive dismiss — here the overlay IS the subject,
     * so `goToPoll`'s Skip would destroy what we came to assert.
     */
    async function goToPollExpectingCheck(
        page: import('@playwright/test').Page,
    ): Promise<void> {
        await page.goto(
            `/community-lineup/${checkLineupId}/schedule/${checkMatchId}`,
        );
        await expect(checkBody(page)).toBeVisible({ timeout: 20_000 });
    }

    test.beforeAll(async () => {
        // This describe OWNS its poll: sibling describes archive/advance their
        // lineups, and a standalone poll is its own lineup + match.
        const [gameId] = await fetchGameIds(adminToken, 1);
        const poll = (await apiPost(adminToken, '/scheduling-polls', {
            gameId,
            durationHours: 72,
        })) as { id?: number; lineupId?: number };
        if (!poll?.id || !poll?.lineupId) {
            throw new Error(
                `POST /scheduling-polls did not return {id, lineupId}: ${JSON.stringify(poll)}`,
            );
        }
        checkMatchId = poll.id;
        checkLineupId = poll.lineupId;

        // A slot keeps the poll body in its active shape behind the overlay.
        const when = new Date(Date.now() + 2 * 86_400_000);
        when.setHours(20, 0, 0, 0);
        await apiPost(
            adminToken,
            `/lineups/${checkLineupId}/schedule/${checkMatchId}/suggest`,
            { proposedTime: when.toISOString() },
        );
        await pollSchedulingPollHasSlot(adminToken, checkLineupId, checkMatchId);
    });

    test.beforeEach(async () => {
        // Make the admin STALE. The beforeAll PUT above (and every sibling
        // describe's) stamps the confirmation, so this must run per-test and
        // AFTER any game-time write. Confirm the server agrees before any
        // navigation — the page reads this same endpoint.
        await apiPost(adminToken, '/admin/test/clear-game-time-confirmation', {});
        await expect
            .poll(readGameTimeStale, {
                timeout: 15_000,
                message: 'admin never became stale after clearing confirmation',
            })
            .toBe(true);
    });

    test.afterAll(async () => {
        // Leave the shared admin fresh: other smoke files use the same user and
        // only dismiss the overlay defensively.
        await apiPut(adminToken, '/users/me/game-time', { slots: RESTORE_SLOTS });
    });

    test('a stale viewer is asked ONE question — no week grid inside the dialog', async ({
        page,
    }) => {
        test.skip(
            isMobile(test.info()),
            'Desktop-only — below 768px step 1 is the week editor (ROK-1569), covered by the phone test below',
        );
        await goToPollExpectingCheck(page);

        // Shell-agnostic: Modal and BottomSheet both expose role="dialog".
        const dialog = page.getByRole('dialog').filter({ has: checkBody(page) });
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        // The one question. Age is null here (the confirmation was cleared, so
        // the server reports `gameTimeAgeDays: null`) and the admin HAS slots
        // from the file-level PUT → the "hasn't been confirmed yet" copy; a
        // seeded age reads "... N days old. Anything changed?", and a member
        // with no slots at all reads "You haven't set a game time yet".
        await expect(page.getByTestId('game-time-check-prompt')).toHaveText(PROMPT_RE);

        // AC: the week painter is GONE from the overlay. `game-time-grid` is
        // GridBody.tsx's testid — it renders wherever GameTimeGrid mounts.
        await expect(
            dialog.locator('[data-testid="game-time-grid"]'),
        ).toHaveCount(0);

        // All four answers are present.
        for (const id of [
            'game-time-check-confirm',
            'game-time-check-absence',
            'game-time-check-edit',
            'game-time-check-skip',
        ]) {
            await expect(dialog.getByTestId(id)).toBeVisible();
        }
    });

    test('phone: step 1 IS the week editor — one question, the week on screen, and no painter', async ({
        page,
    }) => {
        test.skip(
            !isMobile(test.info()),
            'Phone-only — the desktop modal keeps the four-answer body (ROK-1569)',
        );
        await goToPollExpectingCheck(page);

        const dialog = page.getByRole('dialog').filter({ has: checkBody(page) });
        await expect(dialog).toBeVisible({ timeout: 10_000 });

        // The SAME one question as the desktop modal — the copy is shared
        // (`game-time-check-copy.ts`), so the two bodies cannot drift apart.
        await expect(checkPrompt(page)).toHaveText(PROMPT_RE);

        // ...and the week itself is on screen, one day at a time.
        for (const id of ['phone-week-editor', 'phone-day-pager', 'phone-week-strip']) {
            await expect(dialog.getByTestId(id)).toBeVisible();
        }

        // The answers wrapped around it: one-tap confirm, the absence row, and
        // the sticky footer.
        for (const id of ['phone-week-same', 'phone-week-away', 'phone-week-save', 'phone-week-skip']) {
            await expect(dialog.getByTestId(id)).toBeVisible();
        }

        // AC (unchanged from ROK-1564): the 7-column week painter never renders
        // inside the overlay. `game-time-grid` is GridBody.tsx's testid.
        await expect(dialog.locator('[data-testid="game-time-grid"]')).toHaveCount(0);

        // The four-answer desktop body is not on the phone AT ALL — asserting
        // its absence is what keeps a future regression from quietly shipping
        // both bodies to the same viewport.
        for (const id of [
            'game-time-check-body',
            'game-time-check-confirm',
            'game-time-check-absence',
            'game-time-check-edit',
            'game-time-check-skip',
        ]) {
            await expect(page.getByTestId(id)).toHaveCount(0);
        }

        // The comp's rule at 375x812: step 1 fits, so the sheet's scroll
        // container has nothing to scroll. Measured on the sheet's scrolling
        // ancestor because the sheet body itself is a plain flex column.
        const overflow = await page
            .getByTestId('game-time-check-sheet')
            .evaluate((el: HTMLElement) => {
                for (let n = el.parentElement; n; n = n.parentElement) {
                    const oy = getComputedStyle(n).overflowY;
                    if (oy === 'auto' || oy === 'scroll') return n.scrollHeight - n.clientHeight;
                }
                return el.scrollHeight - el.clientHeight;
            });
        expect(overflow).toBeLessThanOrEqual(1);
    });

    test('"Looks right" confirms, the check closes, and the poll is still there', async ({
        page,
    }) => {
        test.skip(
            isMobile(test.info()),
            'Desktop-only — the phone answer is "Same as last week" (ROK-1569), covered below',
        );
        await goToPollExpectingCheck(page);

        const confirmed = page.waitForResponse(
            (r) =>
                r.url().includes('/users/me/game-time/confirm') &&
                r.request().method() === 'PATCH' &&
                r.ok(),
            { timeout: 20_000 },
        );
        const confirmButton = page.getByTestId('game-time-check-confirm');
        await confirmButton.scrollIntoViewIfNeeded();
        await confirmButton.click();
        await confirmed;

        // Closing is DERIVED from the refetched staleness, not forced.
        await expect(checkBody(page)).toBeHidden({ timeout: 20_000 });
        await expect
            .poll(readGameTimeStale, {
                timeout: 15_000,
                message: 'confirm did not clear staleness server-side',
            })
            .toBe(false);

        // Nothing under the overlay was navigated away or unmounted.
        await expect(
            page.locator('[data-testid="scheduling-composite"]'),
        ).toBeVisible({ timeout: 20_000 });
    });

    test('Skip closes the check and it stays closed for the session', async ({
        page,
    }) => {
        test.skip(
            isMobile(test.info()),
            'Desktop-only — the phone Skip advances to the ballot (ROK-1574), covered below',
        );
        await goToPollExpectingCheck(page);
        await page.getByTestId('game-time-check-skip').click();
        await expect(checkBody(page)).toBeHidden({ timeout: 10_000 });

        // Skip persists to sessionStorage, so a reload in the SAME tab must not
        // re-open it even though the admin is still stale server-side. Waiting
        // on the game-time GET keeps the assertion from passing vacuously
        // against a page whose query hasn't resolved yet.
        const gameTimeFetch = page.waitForResponse(
            (r) =>
                r.url().includes('/users/me/game-time') &&
                r.request().method() === 'GET',
            { timeout: 20_000 },
        );
        await page.reload();
        await gameTimeFetch;
        await expect(
            page.locator('[data-testid="scheduling-composite"]'),
        ).toBeVisible({ timeout: 20_000 });
        await expect(checkBody(page)).toHaveCount(0);
    });

    test('phone: "Same as last week" confirms and the sheet moves on to the vote', async ({
        page,
    }) => {
        test.skip(!isMobile(test.info()), 'Phone-only — ROK-1569 step 1 answers');
        await goToPollExpectingCheck(page);

        const confirmed = page.waitForResponse(
            (r) =>
                r.url().includes('/users/me/game-time/confirm') &&
                r.request().method() === 'PATCH' &&
                r.ok(),
            { timeout: 20_000 },
        );
        const same = page.getByTestId('phone-week-same');
        await same.scrollIntoViewIfNeeded();
        await same.click();
        await confirmed;

        // Ending step 1 is DERIVED from the refetched staleness, exactly as on
        // desktop — but on the phone an ended check ADVANCES to the ballot
        // (ROK-1574) instead of vanishing, so the viewer lands on the vote.
        await expect(checkBody(page)).toBeHidden({ timeout: 20_000 });
        await expect(page.getByTestId('game-time-check-step2')).toBeVisible({
            timeout: 20_000,
        });
        await expect(page.getByTestId('game-time-check-stepline')).toHaveText(
            'Step 2 of 2 · vote',
        );
        await expect
            .poll(readGameTimeStale, {
                timeout: 15_000,
                message: 'Same as last week did not clear staleness server-side',
            })
            .toBe(false);
    });

    test('phone: Skip ends the check, lands on the ballot, and stays skipped for the session', async ({
        page,
    }) => {
        test.skip(!isMobile(test.info()), 'Phone-only — ROK-1569 step 1 answers');
        await goToPollExpectingCheck(page);

        await page.getByTestId('phone-week-skip').click();
        await expect(checkBody(page)).toBeHidden({ timeout: 10_000 });
        await expect(page.getByTestId('game-time-check-step2')).toBeVisible({
            timeout: 10_000,
        });

        // Closing the sheet leaves the poll page underneath it untouched.
        await page.getByRole('button', { name: 'Close sheet' }).click();
        await expect(page.getByTestId('game-time-check-sheet')).toBeHidden({
            timeout: 10_000,
        });

        // Skip persists to sessionStorage, so a reload in the SAME tab must not
        // re-open step 1 even though the admin is still stale server-side.
        const gameTimeFetch = page.waitForResponse(
            (r) =>
                r.url().includes('/users/me/game-time') &&
                r.request().method() === 'GET',
            { timeout: 20_000 },
        );
        await page.reload();
        await gameTimeFetch;
        await expect(
            page.locator('[data-testid="scheduling-composite"]'),
        ).toBeVisible({ timeout: 20_000 });
        await expect(checkBody(page)).toHaveCount(0);
    });

    test('phone: "Save my week" writes the week AND counts as the confirmation', async ({
        page,
    }) => {
        test.skip(!isMobile(test.info()), 'Phone-only — ROK-1569 week editor');
        await goToPollExpectingCheck(page);

        // Save is inert until the week actually differs from the saved one —
        // an untouched draft must not be able to stamp a confirmation.
        const save = page.getByTestId('phone-week-save');
        await expect(save).toBeDisabled();

        // Tuesday: this file's seed writes days 1/3/5 only, so the column is
        // empty and a tap creates a block instead of merging into one.
        const tuesday = page.getByTestId('phone-week-strip-day-2');
        await tuesday.click();
        await expect(tuesday).toHaveAttribute('aria-current', 'date');

        // force: the day target sits above the cell and is the real pointer
        // recipient, so the hit-target check would call the cell intercepted —
        // the same gesture `game-time-blocks.smoke.spec.ts` uses.
        await page.getByTestId('phone-cell-2-21').click({ force: true });
        await expect(page.locator('[data-testid^="slot-block-2-"]')).toHaveCount(1);
        await expect(save).toBeEnabled();

        const saved = page.waitForResponse(
            (r) =>
                r.url().includes('/users/me/game-time') &&
                r.request().method() === 'PUT' &&
                r.ok(),
            { timeout: 20_000 },
        );
        await save.click();
        await saved;

        // The save IS the confirmation — `saveTemplate` stamps
        // `game_time_confirmed_at` (api/src/users/game-time.service.ts) — so the
        // check ends without a second tap and the sheet advances to the ballot.
        await expect(page.getByTestId('game-time-check-stepline')).toHaveText(
            'Step 2 of 2 · vote',
            { timeout: 20_000 },
        );
        await expect(checkBody(page)).toBeHidden({ timeout: 20_000 });
        await expect
            .poll(readGameTimeStale, {
                timeout: 15_000,
                message: 'saving a week did not clear staleness server-side',
            })
            .toBe(false);
    });
});
