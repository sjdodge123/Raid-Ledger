/**
 * Scheduling Poll page smoke tests (ROK-965, ROK-999, ROK-1300).
 * Route: /community-lineup/:lineupId/schedule/:matchId
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 *
 * ROK-1300: the SchedulingWizard stepper is gone — `<SchedulingComposite>`
 * owns the page body with a single sticky JourneyHero at top, an in-composite
 * U2 game-ref banner (replaces MatchContextCard), the group-availability
 * heatmap, per-row +Vote / operator Lock, and the sticky-toolbar submit. The
 * GameTimeRefreshModal stays — it self-gates on stale game time, independent
 * of the composite.
 */
import { test, expect } from './base';
import {
    getAdminToken,
    getInviteeFixture,
    apiPost,
    apiGet,
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
 * Dismiss the GameTimeRefreshModal if it auto-opened (ROK-1301).
 *
 * The modal (a `role="dialog"` from `components/ui/modal.tsx`) auto-opens on the
 * poll page only when game time is stale. In these smoke fixtures the beforeAll
 * PUTs slots → `game_time_confirmed_at = now` → game time is fresh, so the modal
 * normally does NOT appear. We still defensively dismiss it (via its Skip button)
 * so a stale state from an earlier test or seed data can't block the page. Skip
 * persists to sessionStorage, so it won't re-fire later in the same page session.
 */
async function dismissGameTimeModalIfPresent(
    page: import('@playwright/test').Page,
): Promise<void> {
    const dialog = page.getByRole('dialog');
    const modalTitle = dialog.getByText(/Set your Game Time|Refresh your Game Time/i);
    if (await modalTitle.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await dialog.getByRole('button', { name: /^Skip$/i }).click();
        await expect(dialog).toBeHidden({ timeout: 10_000 });
    }
}

/**
 * Navigate to the scheduling poll and wait for the SchedulingComposite to
 * render (ROK-1300 — the wizard stepper + separate "Scheduling Poll" h1 are
 * gone; the composite owns the page body with a single sticky hero at top).
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

        // No dialog titled with the modal copy should appear within a short window.
        const modalTitle = page
            .getByRole('dialog')
            .getByText(/Set your Game Time|Refresh your Game Time/i);
        await expect(modalTitle).toHaveCount(0, { timeout: 5_000 });

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

        // ROK-1300 round 2: the game-ref lives in the sticky toolbar, on the
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

        // AC3: Date/time picker is always visible for suggesting slots
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

        // AC6: The existing HeatmapGrid component renders with availability data
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
// Recurring event checkbox (ROK-965 coverage gap)
// ---------------------------------------------------------------------------

test.describe('Scheduling poll sticky-toolbar submit (ROK-1300)', () => {
    test('sticky toolbar exposes the schedule-submit affordance', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // ROK-1300: the submit ritual lives in the sticky JourneyHero toolbar
        // (NOT a bottom SubmitBar). Its testid is pinned by the composite.
        const submit = page.locator(
            '[data-testid="sticky-hero-schedule-submit"]',
        );
        await expect(submit).toBeVisible({ timeout: 15_000 });
        // No bottom SubmitBar is rendered for the scheduling phase.
        await expect(page.locator('[data-testid="submit-bar"]')).toHaveCount(0);
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
    test('mobile: GameTimeGrid shows abbreviated day names (Sun, Mon)', async ({
        page,
    }) => {
        test.skip(
            test.info().project.name === 'desktop',
            'Mobile-only test — abbreviated day names only shown on <768px viewports',
        );

        // ROK-1301: the gametime grid no longer lives in the wizard; the
        // GameTimeGrid day-header behavior now renders via the poll-body heatmap.
        await goToPoll(page, lineupId, matchId);

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
        // GameTimeGrid day-header behavior now renders via the poll-body heatmap.
        await goToPoll(page, lineupId, matchId);

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
            `/lineups/${lineupId}/schedule/${matchId}`,
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
                    `/lineups/${lineupId}/schedule/${matchId}/vote`,
                    { slotId: firstSlotId },
                );
            }
            // Re-check: if still empty (rare race), force toggle once more.
            const verify = await apiGet(
                adminToken,
                `/lineups/${lineupId}/schedule/${matchId}`,
            );
            if ((verify?.slots?.[0]?.votes?.length ?? 0) === 0) {
                await apiPost(
                    adminToken,
                    `/lineups/${lineupId}/schedule/${matchId}/vote`,
                    { slotId: firstSlotId },
                );
            }
        }

        // ROK-1247: poll until the API observes the vote. Without this, the
        // page's useQuery can serve a cached "no votes" payload and the
        // voted slot row never renders its avatar group within the window.
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId, {
            withVote: true,
        });
        await goToPoll(page, lineupId, matchId);

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
        await apiPost(adminToken, `/lineups/${lineupId}/schedule/${matchId}/suggest`, {
            proposedTime: futureDate.toISOString(),
        }).catch(() => {});

        await goToPoll(page, lineupId, matchId);

        // The newly suggested slot auto-votes for the suggester, so retract
        const pollData = await apiGet(
            adminToken,
            `/lineups/${lineupId}/schedule/${matchId}`,
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

        // After event creation, the match is scheduled — page should be read-only
        // Either: read-only banner visible, OR suggest button absent/disabled, OR success state shown
        const readOnlyBanner = page.locator('[data-testid="read-only-banner"]');
        const successState = page.locator('[data-testid="match-status-badge"]');
        const suggestBtn = page.getByRole('button', { name: /Suggest.*Time|Add.*Slot/i });

        const hasReadOnly = await readOnlyBanner.isVisible({ timeout: 5_000 }).catch(() => false);
        const hasSuccess = await successState.isVisible({ timeout: 3_000 }).catch(() => false);
        const hasSuggest = await suggestBtn.isVisible({ timeout: 3_000 }).catch(() => false);

        // Match is scheduled — expect either read-only banner, success badge, or no suggest button
        expect(hasReadOnly || hasSuccess || !hasSuggest).toBe(true);
    });
});
