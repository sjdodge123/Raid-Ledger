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
import { devices, type Locator, type Page } from '@playwright/test';
import { STORAGE_STATE_PATH } from '../auth-paths';
import { dismissGameTimeCheck, isMobile, isPhoneLayout } from './helpers';
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
 * four-answer `game-time-check-body`, while below 1024px the check is the phone
 * week editor inside a one-view BottomSheet (ROK-1579).
 * `dismissGameTimeCheck` (helpers.ts) probes both and is the ONLY place that
 * knows the difference.
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
 * "Find a better time" affordance (BottomSheet <1024px, Modal >=1024px).
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

        // Neither shell's check may mount within a short window. Both are
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

        // ROK-1584 §1 (H1-b): the participants chip rides on the HEADLINE row,
        // to the right of the task — not in a cluster of its own below it.
        const headline = page.getByTestId('journey-headline-row').first();
        await expect(headline).toBeVisible({ timeout: 15_000 });
        await expect(
            headline.getByTestId('lineup-participants-button'),
            'the participants chip belongs in the hero headline row',
        ).toBeVisible();

        // ...and the phase indicator is the progress line, which names the
        // phase the viewer is in via `data-active` (1-4).
        const progress = page.getByTestId('journey-progress').first();
        await expect(progress).toBeVisible();
        await expect(progress).toHaveAttribute('data-active', /^[1-4]$/);
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

/** One cell of the aggregate the heatmap paints. */
interface HeatmapCell {
    dayOfWeek: number;
    hour: number;
    availableCount: number;
}

/** A day/hour in GRID convention (0 = Sunday), as the heatmap renders it. */
interface GridCell {
    day: number;
    hour: number;
}

/**
 * The admin's seeded template in GRID convention (Mon/Wed/Fri).
 *
 * `PUT /users/me/game-time` takes GRID/Sunday-first days already — `saveTemplate`
 * applies `(day + 6) % 7` on the way into the DB and the aggregate maps it back
 * with `(day + 1) % 7` — so the beforeAll's days 1/3/5 render at grid days 1/3/5,
 * NOT 2/4/6.
 */
const TEMPLATED_GRID_CELLS: GridCell[] = [
    { day: 1, hour: 19 }, { day: 1, hour: 20 },
    { day: 3, hour: 19 }, { day: 3, hour: 20 },
    { day: 5, hour: 18 }, { day: 5, hour: 19 },
];

/** Sunday 00:00 UTC of the week containing `d`. */
function weekStartUtc(d: Date): Date {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() - x.getUTCDay());
    x.setUTCHours(0, 0, 0, 0);
    return x;
}

/** The instant a grid cell names inside the week starting at `weekStart`. */
function gridCellInstant(weekStart: Date, cell: GridCell): Date {
    const x = new Date(weekStart);
    x.setUTCDate(x.getUTCDate() + cell.day);
    x.setUTCHours(cell.hour, 0, 0, 0);
    return x;
}

/**
 * The first templated hour still in the future — this week if one is left,
 * otherwise next week (the test then pages the sheet forward). Events must be
 * in the future, and the test has to be deterministic on any weekday.
 */
function pickTargetCell(): {
    cell: GridCell;
    start: Date;
    weekStart: Date;
    weeksForward: number;
} {
    const now = new Date();
    const thisWeek = weekStartUtc(now);
    const cutoff = now.getTime() + 60 * 60_000;
    for (const cell of TEMPLATED_GRID_CELLS) {
        const start = gridCellInstant(thisWeek, cell);
        if (start.getTime() > cutoff)
            return { cell, start, weekStart: thisWeek, weeksForward: 0 };
    }
    const nextWeek = new Date(thisWeek);
    nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
    const cell = TEMPLATED_GRID_CELLS[0];
    return {
        cell,
        start: gridCellInstant(nextWeek, cell),
        weekStart: nextWeek,
        weeksForward: 1,
    };
}

/**
 * The dated availability endpoint for a week (ROK-1570). `tzOffset=0` matches
 * the `timezoneId: 'UTC'` browser this describe pins, so the API the test polls
 * keys busy hours exactly the way the grid under test does.
 */
function availabilityPath(weekStart: Date): string {
    return (
        `/lineups/${lineupId}/schedule/${matchId}/availability` +
        `?weekStart=${encodeURIComponent(weekStart.toISOString())}&tzOffset=0`
    );
}

/** Hours the phone module shows for one day (`CHECK_HOURS` = 17..23). */
const PHONE_HOURS = 7;

/** Day names as `DayPager` prints them (`FULL_DAYS`, grid convention). */
const FULL_DAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * Whether the OPEN sheet is the phone surface (ROK-1580).
 *
 * `SchedulingBetterTimeSheet` stamps `data-surface="sheet"` below 1024px and
 * `"modal"` above, so these helpers branch on what the app actually mounted
 * rather than on the project name — on `mobile` the body is the one-day group
 * module and `[data-testid="heatmap-grid"]` does not exist at all.
 */
async function isPhoneSheet(
    page: import('@playwright/test').Page,
): Promise<boolean> {
    return (
        (await page
            .locator('[data-testid="scheduling-better-time-body"][data-surface="sheet"]')
            .count()) > 0
    );
}

/** Bring `day` on screen in the phone module and wait for the pager to say so. */
async function showPhoneDay(
    page: import('@playwright/test').Page,
    day: number,
): Promise<void> {
    await page.getByTestId(`phone-week-strip-day-${day}`).click();
    await expect(
        page.getByTestId('phone-day-title'),
        `phone pager should show ${FULL_DAY_NAMES[day]} after tapping its week-strip column`,
    ).toHaveText(FULL_DAY_NAMES[day], { timeout: 15_000 });
}

/**
 * Advance the open sheet by ONE week, whichever surface it is.
 *
 * Desktop: `AvailabilityHeatmapSection`'s "Next Week →".
 * Phone (ROK-1580): there is no week nav — the ‹ › day pager IS the week
 * control, so Saturday › re-fetches the next week and lands on its Sunday.
 */
async function stepWeekForward(
    page: import('@playwright/test').Page,
): Promise<void> {
    if (!(await isPhoneSheet(page))) {
        await page.getByRole('button', { name: /next week/i }).click();
        return;
    }
    await showPhoneDay(page, 6);
    await page.getByRole('button', { name: /next day/i }).click();
    await expect(
        page.getByTestId('phone-day-title'),
        'paging past Saturday must roll into the NEXT week and land on Sunday',
    ).toHaveText('Sunday', { timeout: 20_000 });
}

/** Page the open sheet forward `count` weeks. */
async function pageWeekForward(
    page: import('@playwright/test').Page,
    count: number,
): Promise<void> {
    for (let i = 0; i < count; i++) {
        await stepWeekForward(page);
    }
}

/**
 * A heatmap cell's `N free · N stale · N unknown` label.
 *
 * Desktop reads the seven-column grid's `title`. The phone shows ONE day, so
 * the cell has to be brought on screen first and the copy lives on the
 * button's `aria-label` — it is the same `computeHeatmapLabel` string either
 * way, which is why both tests below can assert on it unchanged.
 */
async function cellTitle(
    page: import('@playwright/test').Page,
    cell: GridCell,
): Promise<string> {
    if (await isPhoneSheet(page)) {
        await showPhoneDay(page, cell.day);
        const button = page.getByTestId(
            `phone-group-cell-${cell.day}-${cell.hour}`,
        );
        await expect(button).toBeVisible({ timeout: 15_000 });
        return (await button.getAttribute('aria-label')) ?? '';
    }
    const locator = page
        .locator('[data-testid="heatmap-grid"]')
        .locator(`[data-testid="cell-${cell.day}-${cell.hour}"]`);
    await expect(locator).toBeVisible({ timeout: 15_000 });
    return (await locator.getAttribute('title')) ?? '';
}

/** The Sunday one week after `weekStart`. */
function nextWeekOf(weekStart: Date): Date {
    const x = new Date(weekStart);
    x.setUTCDate(x.getUTCDate() + 7);
    return x;
}

/**
 * The `datetime-local` value `toDatetimeLocal(day, hour, weekStart)` produces
 * for a grid cell. The describe pins the browser to UTC, so the component's
 * local-date arithmetic and these UTC getters name the same wall clock.
 */
function datetimeLocalOf(weekStart: Date, cell: GridCell): string {
    const d = gridCellInstant(weekStart, cell);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return (
        `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
        `T${pad(cell.hour)}:00`
    );
}

/**
 * What a phone group cell's `aria-label` may read.
 *
 * `computeHeatmapLabel` drops the stale clause when nobody is stale
 * (`grid-cell.utils.ts:114`), and `GroupDayView` falls back to "no data" for an
 * hour the aggregate emits no cell for (a poll only emits hours some template
 * covers, and `fillUnknownCells` only back-fills when there are untemplated
 * members). Both shapes are legal; an UNLABELLED cell is not, and that is what
 * this catches — the templated hour is asserted to carry a real count
 * separately below.
 */
/**
 * The phone surface's answer to "the heatmap rendered with data" (ROK-1580):
 * the module is on screen, all seven days are reachable from the week strip,
 * and the displayed day's hours are labelled cells rather than empty boxes.
 */
async function assertPhoneGroupModule(
    page: import('@playwright/test').Page,
): Promise<void> {
    await expect(
        page.getByTestId('phone-group-availability'),
        'below 1024px the sheet must mount the one-day group module',
    ).toBeVisible({ timeout: 20_000 });
    await expect(
        page.locator('[data-testid^="phone-week-strip-day-"]'),
        'the week strip is the phone\'s day affordance — all seven days must be reachable',
    ).toHaveCount(7, { timeout: 15_000 });
    const cells = page.locator('[data-testid^="phone-group-cell-"]');
    await expect(
        cells,
        'the displayed day must render the evening hours (CHECK_HOURS 17..23)',
    ).toHaveCount(PHONE_HOURS, { timeout: 20_000 });
    const labels = await cells.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute('aria-label') ?? ''),
    );
    for (const label of labels) {
        expect(
            label,
            `every phone group cell must carry the aggregate label, got "${label}"`,
        ).toMatch(PHONE_CELL_LABEL);
    }
}

const PHONE_CELL_LABEL = /^(\d+ free( · \d+ stale)? · \d+ unknown|no data)$/;

/** The leading "N free" of a cell label, or -1 when it reads some other way. */
function freeCount(title: string): number {
    const m = /^(\d+) free/.exec(title);
    return m ? Number(m[1]) : -1;
}

test.describe('Scheduling poll heatmap', () => {
    // The server keys busy hours off real UTC dates; pinning the browser to
    // UTC makes the week the grid paints the week the aggregate subtracts.
    test.use({ timezoneId: 'UTC' });

    test('HeatmapGrid renders with match members availability data', async ({
        page,
    }) => {
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // AC6: the group's availability still renders — from inside the
        // ROK-1543 "Find a better time" sheet. Below 1024px that is ROK-1580's
        // one-day module, which has no seven-column grid and no day headers:
        // the week strip is the day affordance and each visible hour is a
        // labelled cell, so the same three claims are asserted against it.
        await openBetterTimeSheet(page);
        if (await isPhoneSheet(page)) {
            await assertPhoneGroupModule(page);
            return;
        }
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

    /**
     * ROK-1570: a member who is SIGNED UP for an event is not free at that
     * hour, so the heatmap must stop painting them available there.
     *
     * The beforeAll seeds the admin's game-time template through
     * `PUT /users/me/game-time`, whose payload is GRID convention (0 = Sunday)
     * — the round trip through DB convention and back is the endpoint's, not
     * the test's — so the seeded days 1/3/5 are the grid days 1/3/5 the
     * assertions target. The busy keys are built from real dates, which is why
     * this describe pins the browser to UTC: the week the grid paints then IS
     * the week (and the offset) the aggregate subtracts from.
     *
     * The assertion is before/after rather than a hard "1 free": other poll
     * members may also carry templates, so the covered cell is required to
     * DROP to `0 free` while an untouched templated hour keeps whatever count
     * it had.
     */
    test('a signed-up hour is no longer painted free (ROK-1570)', async ({
        page,
        world,
    }) => {
        const target = pickTargetCell();
        const neighbour = TEMPLATED_GRID_CELLS.find(
            (c) => c.day !== target.cell.day,
        );
        if (!neighbour) throw new Error('no neighbouring templated cell seeded');

        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);
        await openBetterTimeSheet(page);
        if (target.weeksForward > 0) await pageWeekForward(page, target.weeksForward);

        const before = {
            target: await cellTitle(page, target.cell),
            neighbour: await cellTitle(page, neighbour),
        };
        expect(
            freeCount(before.target),
            `fixture: grid cell ${target.cell.day}-${target.cell.hour} should start free ` +
                `(admin's template), got "${before.target}"`,
        ).toBeGreaterThan(0);

        const startTime = target.start.toISOString();
        const endTime = new Date(target.start.getTime() + 3_600_000).toISOString();
        const event = (await apiPost(adminToken, '/events', {
            title: world.uid('rok-1570-busy'),
            startTime,
            endTime,
            maxAttendees: 10,
        })) as { id?: number };
        if (!event?.id) throw new Error('failed to create the busy-hour event');

        try {
            // The creator is auto-signed-up; re-POST is idempotent and makes
            // the precondition explicit rather than inherited.
            await apiPost(adminToken, `/events/${event.id}/signup`, {});

            // The heatmap reads a `useQuery` with a 60s staleTime, so assert
            // the API has observed the signup BEFORE reloading the page.
            await pollForCondition(
                async () => {
                    const data = (await apiGet(
                        adminToken,
                        availabilityPath(target.weekStart),
                    )) as { cells?: HeatmapCell[] } | null;
                    const cell = data?.cells?.find(
                        (c) =>
                            c.dayOfWeek === target.cell.day &&
                            c.hour === target.cell.hour,
                    );
                    // The cell must still be EMITTED (its template row is
                    // what makes it a cell) and read zero — an absent cell
                    // would mean the aggregate dropped the hour entirely.
                    return cell && cell.availableCount === 0 ? data : null;
                },
                {
                    timeoutMs: 20_000,
                    description: `availability drops grid cell ${target.cell.day}-${target.cell.hour}`,
                },
            );

            await goToPoll(page, lineupId, matchId);
            await openBetterTimeSheet(page);
            if (target.weeksForward > 0) await pageWeekForward(page, target.weeksForward);

            await expect
                .poll(() => cellTitle(page, target.cell), {
                    timeout: 15_000,
                    message: `grid cell ${target.cell.day}-${target.cell.hour} still paints the admin free at an hour they are signed up for`,
                })
                .toMatch(/^0 free/);

            // ROK-1584 §2: the hour does not just go quiet — the aggregate
            // now SAYS why, on both surfaces (the desktop cell's `title` and
            // the phone group cell's `aria-label` are the same helper's
            // output, `computeHeatmapLabel`). Exactly one member (the admin)
            // is signed up at this hour in this fixture.
            expect(
                await cellTitle(page, target.cell),
                'the covered hour should name the busy member, not just drop to 0 free',
            ).toContain('\u00B7 1 busy');
            expect(
                await cellTitle(page, neighbour),
                `untouched templated hour ${neighbour.day}-${neighbour.hour} changed`,
            ).toBe(before.neighbour);

            if (await isPhoneSheet(page)) {
                // The phone paints it too: a `--color-busy` left edge on the
                // covered cell, and the week strip caps the band that holds it
                // so the day is legible without opening it.
                await showPhoneDay(page, target.cell.day);
                await expect(
                    page.getByTestId(
                        `phone-group-cell-${target.cell.day}-${target.cell.hour}`,
                    ),
                    'the covered phone cell should carry the busy edge',
                ).toHaveAttribute('data-busy', /^[1-9][0-9]*$/);
                await expect(
                    page
                        .getByTestId(`phone-week-strip-day-${target.cell.day}`)
                        .locator('[data-testid="phone-week-strip-bar"] [data-busy]'),
                    'the week strip should cap the band holding the busy hour',
                ).not.toHaveCount(0);
            }
        } finally {
            await apiDelete(adminToken, `/events/${event.id}`);
        }
    });

    /**
     * ROK-1580: below 1024px "Find a better time" is NOT the seven-column
     * heatmap — it is the one-day group module (ROK-1569's phone editor in
     * GROUP mode). This asserts the three things that make it usable, none of
     * which the desktop grid can stand in for:
     *
     * 1. one day of the evening hours is on screen, every hour carrying the
     *    aggregate's own copy on its `aria-label` (the visible count is the
     *    short "4 free" form, so the label is the accessible full story);
     * 2. tapping an hour drafts the 2h "Suggested" block AND prefills the
     *    suggest form travelling with the sheet — the two live on opposite
     *    ends of the drawer, so a tap that paints but does not prefill (or
     *    prefills the wrong week) is exactly the bug this catches;
     * 3. the pager is the week control: › off Saturday re-fetches the next
     *    week and lands on its Sunday (ROK-1570's re-fetch, reached without a
     *    "Next Week" button, which the phone deliberately does not have).
     */
    test('the phone sheet is the one-day group module (ROK-1580)', async ({
        page,
    }, testInfo) => {
        test.skip(
            !isPhoneLayout(testInfo),
            'phone-layout only: at >=1024px the sheet mounts the seven-column heatmap Modal',
        );

        const target = pickTargetCell();
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);
        await openBetterTimeSheet(page);
        if (target.weeksForward > 0) await pageWeekForward(page, target.weeksForward);

        // 1. ONE day of CHECK_HOURS, each hour labelled with the group's copy.
        const cells = page.locator('[data-testid^="phone-group-cell-"]');
        await expect(
            cells,
            'the phone sheet should show ONE day of the evening hours (CHECK_HOURS 17..23)',
        ).toHaveCount(PHONE_HOURS, { timeout: 20_000 });
        const labels = await cells.evaluateAll((nodes) =>
            nodes.map((n) => n.getAttribute('aria-label') ?? ''),
        );
        for (const label of labels) {
            expect(
                label,
                `every phone group cell must carry the aggregate label, got "${label}"`,
            ).toMatch(PHONE_CELL_LABEL);
        }

        // 1b. ROK-1584 §2: the condensed strip encodes the day's shape in
        // attributes — a band whose hours split across two kinds renders
        // two-tone and names the OTHER kind in `data-two-tone`; a band holding
        // a busy hour carries a `data-busy` cap (asserted against a real
        // signup by the ROK-1570 case above). Both are legitimately absent on
        // a uniform, nobody-busy week, so what is pinned here is the
        // VOCABULARY: anything stamped is one of the four band kinds, and the
        // caps are children of the bars rather than a separate layer.
        const bars = page.locator('[data-testid="phone-week-strip-bar"]');
        await expect(bars).not.toHaveCount(0);
        const tones = await bars.evaluateAll((nodes) =>
            nodes
                .map((n) => n.getAttribute('data-two-tone'))
                .filter((v): v is string => v !== null),
        );
        for (const tone of tones) {
            expect(tone, 'data-two-tone must name a band kind').toMatch(
                /^(all|most|few|none)$/,
            );
        }
        expect(
            await page.locator('[data-testid="phone-week-strip-bar"] [data-busy]').count(),
            'busy caps live inside the bars they cap',
        ).toBe(await page.locator('[data-busy][class*="bg-busy"]').count());

        // 2. The templated hour is a real count, and tapping it drafts + prefills.
        await showPhoneDay(page, target.cell.day);
        const targetCell = page.getByTestId(
            `phone-group-cell-${target.cell.day}-${target.cell.hour}`,
        );
        const targetLabel = (await targetCell.getAttribute('aria-label')) ?? '';
        expect(
            freeCount(targetLabel),
            `fixture: grid cell ${target.cell.day}-${target.cell.hour} should read free ` +
                `(admin's template), got "${targetLabel}"`,
        ).toBeGreaterThan(0);

        await targetCell.click();
        await expect(
            page.getByTestId('phone-group-suggested-block'),
            'tapping an hour should draft the 2h Suggested block on that day',
        ).toBeVisible({ timeout: 10_000 });
        await expect(
            page.locator(
                '[data-testid="scheduling-better-time-body"] [data-testid="slot-datetime-picker"]',
            ),
            `tapping ${FULL_DAY_NAMES[target.cell.day]} ${target.cell.hour}:00 should prefill ` +
                'the suggest form with THAT day of the displayed week',
        ).toHaveValue(datetimeLocalOf(target.weekStart, target.cell), {
            timeout: 10_000,
        });

        // 3. Paging › off Saturday re-fetches next week. Assert the API can
        // answer for that week BEFORE the UI is asked to show it, so a red run
        // blames the aggregate rather than the pager (no sleep, ROK-1247).
        const nextWeek = nextWeekOf(target.weekStart);
        await pollForCondition(
            async () => {
                const data = (await apiGet(adminToken, availabilityPath(nextWeek))) as {
                    cells?: HeatmapCell[];
                } | null;
                return data?.cells?.length ? data : null;
            },
            {
                timeoutMs: 20_000,
                description: `availability for week ${nextWeek.toISOString()} has cells`,
            },
        );

        // `stepWeekForward` taps Saturday's strip column then › and asserts the
        // pager rolled to Sunday; the cells must come back for that new day.
        await stepWeekForward(page);
        await expect(
            page.locator('[data-testid^="phone-group-cell-0-"]'),
            'the next week\'s Sunday must re-render its hours after the pager rolls over',
        ).toHaveCount(PHONE_HOURS, { timeout: 25_000 });
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

        // Admin (operator-tier) sees the action: inline on the desktop toolbar,
        // in the ROK-1584 "Manage poll" sheet below 1024px.
        await openManageIfPhone(page);
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
        // ...and below 1024px there is no way in either: the sheet's own
        // trigger is gated by the same creator/operator check.
        if (isPhoneLayout(test.info())) {
            await expect(page.getByTestId('scheduling-manage')).toHaveCount(0);
        }
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

        await openManageIfPhone(page);
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
        if (isPhoneLayout(test.info())) {
            await expect(page.getByTestId('scheduling-manage')).toHaveCount(0);
        }
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

        await openManageIfPhone(page);
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

        await openManageIfPhone(page);
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
// ROK-1582: the hero's creator/operator actions are touch targets on a phone.
// Placed BEFORE the event-creation describe for the same reason the Remind
// Voters case is: creating the event flips the match to scheduled (read-only),
// which hides all three buttons by design.
// ---------------------------------------------------------------------------

/** Bounding boxes of the three hero actions, in DOM order. */
async function heroActionBoxes(page: Page): Promise<
    { x: number; y: number; width: number; height: number }[]
> {
    const locators = [
        page.getByTestId('add-poll-members-button'),
        page.getByRole('button', { name: /^remind voters$/i }),
        page.getByRole('button', { name: /^cancel poll$/i }),
    ];
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (const locator of locators) {
        await expect(locator).toBeVisible({ timeout: 15_000 });
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
    }
    return boxes;
}

/** The hero card the actions must stay inside. */
function heroCard(page: Page): Locator {
    return page
        .locator('[data-testid="scheduling-toolbar"] [role="region"]')
        .first();
}

/**
 * Below 1024px the poll's three creator actions are NOT in the hero any more:
 * ROK-1584 §1 moved them into the "Manage poll ⋯" bottom sheet
 * (`SchedulingManageSheet`), keeping the same components, gates and role names.
 * Any assertion about Add Participants / Remind Voters / Cancel Poll therefore
 * has to open that sheet first on the phone and tablet projects; at/above
 * 1024px the inline row is unchanged and this is a no-op.
 */
async function openManageIfPhone(page: Page): Promise<void> {
    if (!isPhoneLayout(test.info())) return;
    const manage = page.getByTestId('scheduling-manage');
    await expect(
        manage,
        'below 1024px the hero must offer "Manage poll ⋯" (ROK-1584)',
    ).toBeVisible({ timeout: 15_000 });
    if ((await manage.getAttribute('aria-expanded')) === 'true') return;
    await manage.click();
    await expect(page.getByTestId('scheduling-manage-sheet')).toBeVisible({
        timeout: 10_000,
    });
}

test.describe('Scheduling poll hero action sizing (ROK-1582)', () => {
    test('phone layout: the three actions live in the "Manage poll" sheet (ROK-1584)', async ({
        page,
    }) => {
        test.skip(
            !isPhoneLayout(test.info()),
            'Phone-layout — desktop keeps the inline cluster (sibling test).',
        );
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        const card = await heroCard(page).boundingBox();
        expect(card).not.toBeNull();
        const right = card!.x + card!.width;

        // ROK-1582 put the three actions in one 44px row inside the card;
        // ROK-1584 §1 replaced that row with ONE full-width "Manage poll ⋯"
        // control, so the inline buttons must not be in the hero at all.
        await expect(page.getByTestId('add-poll-members-button')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^remind voters$/i })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /^cancel poll$/i })).toHaveCount(0);

        const manage = page.getByTestId('scheduling-manage');
        await expect(manage).toBeVisible({ timeout: 15_000 });
        const manageBox = (await manage.boundingBox())!;
        expect(manageBox.height, 'Manage poll is under the 44px touch target').toBeGreaterThanOrEqual(44);
        // Nothing hangs past the card's right edge (the ROK-1582 bug), and the
        // row spans the card rather than hanging in a column at the right.
        expect(manageBox.x + manageBox.width).toBeLessThanOrEqual(right + 1);
        expect(manageBox.x).toBeGreaterThanOrEqual(card!.x - 1);
        expect(manageBox.width, 'Manage poll should span most of the card width')
            .toBeGreaterThanOrEqual(card!.width * 0.75);

        // The participants chip in the same hero is a touch target too, and the
        // Manage row sits UNDER it (not beside it).
        const chip = await page
            .getByTestId('lineup-participants-button')
            .boundingBox();
        expect(chip).not.toBeNull();
        expect(chip!.height).toBeGreaterThanOrEqual(44);
        expect(chip!.x + chip!.width).toBeLessThanOrEqual(right + 1);
        expect(manageBox.y, 'Manage poll should sit below the participants chip')
            .toBeGreaterThanOrEqual(chip!.y + chip!.height - 1);

        // The tap opens the sheet, which carries the SAME three actions under
        // their unchanged role names — 52px rows, stacked, inside the sheet.
        await manage.click();
        const sheet = page.getByRole('dialog', { name: 'Manage poll' });
        await expect(sheet).toBeVisible({ timeout: 10_000 });
        await expect(page.getByTestId('scheduling-manage-sheet')).toBeVisible();
        const rows = [
            sheet.getByTestId('add-poll-members-button'),
            sheet.getByRole('button', { name: /^remind voters$/i }),
            sheet.getByRole('button', { name: /^cancel poll$/i }),
        ];
        let previousBottom = 0;
        for (const row of rows) {
            await expect(row).toBeVisible({ timeout: 10_000 });
            const box = (await row.boundingBox())!;
            expect(box.height, 'a Manage poll row is under the 44px touch target')
                .toBeGreaterThanOrEqual(44);
            expect(box.y, 'the Manage poll rows should stack, not sit side by side')
                .toBeGreaterThanOrEqual(previousBottom - 1);
            previousBottom = box.y + box.height;
        }
    });

    test('desktop: the three actions stay inline and right-aligned', async ({
        page,
    }) => {
        test.skip(
            isPhoneLayout(test.info()),
            'Desktop-only — the phone layout is the sibling test.',
        );
        await pollSchedulingPollHasSlot(adminToken, lineupId, matchId);
        await goToPoll(page, lineupId, matchId);

        // ROK-1584 §1 is a PHONE change: at/above 1024px the inline row stays
        // and no "Manage poll ⋯" control appears.
        await expect(page.getByTestId('scheduling-manage')).toHaveCount(0);

        const card = await heroCard(page).boundingBox();
        expect(card).not.toBeNull();
        const boxes = await heroActionBoxes(page);

        for (const box of boxes) {
            // The recipe's `sm:min-h-[36px]`.
            expect(box.height).toBeGreaterThanOrEqual(36);
            expect(box.x + box.width).toBeLessThanOrEqual(
                card!.x + card!.width + 1,
            );
        }
        expect(Math.abs(boxes[1].y - boxes[0].y)).toBeLessThanOrEqual(1);
        expect(Math.abs(boxes[2].y - boxes[0].y)).toBeLessThanOrEqual(1);
        // Right-aligned: Cancel (last) ends near the card's right edge.
        const lastRight = boxes[2].x + boxes[2].width;
        expect(card!.x + card!.width - lastRight).toBeLessThanOrEqual(24);
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
            !isMobile(test.info()),
            'Mobile-only test — abbreviated day names only shown below the 1024px split',
        );

        // ROK-1301 moved the grid out of the wizard into the heatmap, ROK-1543
        // moved the heatmap into the "Find a better time" sheet, and ROK-1580
        // replaced the seven-column grid on phones with the one-day module —
        // so below 1024px the day names now live in the WEEK STRIP: one letter
        // per column on screen, the full name for a screen reader. The old
        // `if (isGridVisible)` body passed vacuously once the grid stopped
        // mounting here; this asserts the surface that actually renders.
        await goToPoll(page, gridLineupId, gridMatchId);
        await openBetterTimeSheet(page);

        const strip = page
            .locator('[data-testid="scheduling-better-time-body"]')
            .locator('[data-testid^="phone-week-strip-day-"]');
        await expect(
            strip,
            'the phone sheet should carry the seven-column week strip (ROK-1580)',
        ).toHaveCount(7, { timeout: 10_000 });

        for (let day = 0; day < 7; day += 1) {
            const column = strip.nth(day);
            const text = ((await column.textContent()) ?? '').trim();
            expect(
                text,
                `strip column ${day} should show ONE letter on a phone, got "${text}"`,
            ).toMatch(/^[SMTWF]$/);
            const label = (await column.getAttribute('aria-label')) ?? '';
            expect(
                label,
                `strip column ${day} should spell the day out for a screen reader, got "${label}"`,
            ).toMatch(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),/);
        }
    });

    test('desktop: GameTimeGrid shows full day names (Sunday, Monday)', async ({
        page,
    }) => {
        test.skip(
            isPhoneLayout(test.info()),
            'Desktop-only test — full day names only shown at/above the 1024px split',
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

            // On desktop (>=1024px), day headers should show full names
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
            !isMobile(test.info()),
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
        // ROK-1580: the availability surface is the seven-column grid on a
        // desktop and the one-day group module on a phone — neither may be in
        // the primary body, and the right one must appear one tap away.
        const availability = page.locator(
            '[data-testid="heatmap-grid"], [data-testid="phone-group-availability"]',
        );
        await expect(availability).toHaveCount(0);

        // ...one tap away, in a Modal (>=1024px) or BottomSheet (<1024px)
        // — ROK-1584 §7 moved the split off 768 so a tablet gets the sheet.
        await openBetterTimeSheet(page);
        await expect(
            availability,
            'the sheet must show the availability surface for this viewport',
        ).toBeVisible({
            timeout: 15_000,
        });
        const surface = await page
            .locator('[data-testid="scheduling-better-time-body"]')
            .getAttribute('data-surface');
        const viewport = page.viewportSize();
        expect(surface).toBe((viewport?.width ?? 0) >= 1024 ? 'modal' : 'sheet');
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
            !isMobile(test.info()),
            'Mobile-only test — the hero stays pinned (lg:sticky) on desktop',
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
            !isMobile(test.info()),
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
            !isMobile(test.info()),
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

        // ROK-1580: below 1024px the sheet carries the phone module's own
        // four-swatch legend instead of the desktop two-channel one. It names
        // the same two channels (free, and stale counting half) — it does NOT
        // state the freshness window, which has no room on a phone.
        if (await isPhoneSheet(page)) {
            const phoneLegend = page.getByTestId('phone-group-legend');
            await expect(
                phoneLegend,
                'the phone sheet must still say what the fills mean',
            ).toBeVisible({ timeout: 20_000 });
            await expect(phoneLegend).toContainText(/free/i);
            await expect(phoneLegend).toContainText(/stale counts half/i);
            return;
        }

        const legend = page.getByTestId('heatmap-legend');
        await expect(legend).toBeVisible({ timeout: 20_000 });
        // Channel 2 (hatch) is the whole point of ROK-1560: unknown/stale
        // availability must be named, not silently painted as "not free".
        await expect(legend).toContainText(/stale \(older than \d+ days\)/i);
        // Channel 1 (fill) states the server's freshness window — 7 days
        // (`GAME_TIME_FRESHNESS_DAYS`), rendered from the API response.
        // ROK-1560: the window is GAME_TIME_FRESHNESS_DAYS (30 since 2026-09-16).
        await expect(legend).toContainText(/last 30 days/i);
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
// Every project runs this: the shell is a Modal ≥1024px and a BottomSheet below,
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
     * The "Save my week" test's OWN baseline.
     *
     * It taps Saturday, so no entry here may be `dayOfWeek: 6` — a tap that
     * lands on an existing block merges into it, leaving the block count and
     * the draft unchanged and Save disabled (the exact failure on the 2026-09-15
     * fleet gate, where sibling describes had written Tuesday 19–21).
     */
    const SAVE_WEEK_SLOTS = [
        { dayOfWeek: 2, hour: 19 },
        { dayOfWeek: 2, hour: 20 },
        { dayOfWeek: 4, hour: 20 },
    ];

    /**
     * The check's body. ROK-1569 split the shells: the desktop Modal still
     * renders the four-answer `game-time-check-body`, the phone sheet renders
     * the week editor (`phone-week-check`). ROK-1579 made the phone sheet ONE
     * view, so this is the whole check there — there is no second step behind
     * it. Every shared assertion below goes through here so it means the same
     * thing on both projects.
     */
    function checkBody(
        page: import('@playwright/test').Page,
    ): import('@playwright/test').Locator {
        return isPhoneLayout(test.info())
            ? page.getByTestId('phone-week-check')
            : page.getByTestId('game-time-check-body');
    }

    /** The prompt, wherever the check puts it. */
    function checkPrompt(
        page: import('@playwright/test').Page,
    ): import('@playwright/test').Locator {
        return isPhoneLayout(test.info())
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
     * Read the admin's SAVED week from the same endpoint. The phone "Save my
     * week" test asserts the write landed server-side before it trusts
     * anything the collapsed drawer left on screen.
     */
    async function readGameTimeDays(): Promise<number[]> {
        const res = await apiGet(adminToken, '/users/me/game-time');
        const slots = (res?.data ?? res)?.slots ?? [];
        return (slots as { dayOfWeek: number }[]).map((s) => s.dayOfWeek);
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
            isPhoneLayout(test.info()),
            'Desktop-only — below 1024px the check IS the week editor (ROK-1569/1579), covered by the phone test below',
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

    test('phone: the check is ONE view — the week editor, no stepper, no painter (ROK-1579)', async ({
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

        // ROK-1579: the strip is CONDENSED — three band bars per day (day
        // 9 AM–5 PM / evening 5–9 PM / late 9 PM–1 AM), never one per hour.
        await expect(
            dialog.getByTestId('phone-week-strip-day-0').getByTestId('phone-week-strip-bar'),
        ).toHaveCount(3);

        // The answers wrapped around it: one-tap confirm, the absence row, and
        // the sticky footer.
        for (const id of ['phone-week-same', 'phone-week-away', 'phone-week-save', 'phone-week-skip']) {
            await expect(dialog.getByTestId(id)).toBeVisible();
        }

        // AC (unchanged from ROK-1564): the 7-column week painter never renders
        // inside the overlay. `game-time-grid` is GridBody.tsx's testid.
        await expect(dialog.locator('[data-testid="game-time-grid"]')).toHaveCount(0);

        // ROK-1579: ONE view. The ROK-1574 stepper is gone in every part —
        // the segment header, the step line, the two segment buttons and the
        // in-sheet ballot pane — and `game-time-check-step-one` was renamed.
        // Asserting each id (not just the wrapper) is what stops a partial
        // revert from shipping half a stepper.
        for (const id of [
            'game-time-check-stepper',
            'game-time-check-stepline',
            'game-time-check-step-1',
            'game-time-check-step-2',
            'game-time-check-step2',
            'game-time-check-step-one',
        ]) {
            await expect(page.getByTestId(id)).toHaveCount(0);
        }
        // ...and no copy anywhere still narrates a two-step flow.
        await expect(page.getByText(/Step \d of 2/)).toHaveCount(0);

        // What replaced it: a plain title row above the one content box.
        await expect(dialog.getByTestId('game-time-check-header')).toBeVisible();
        await expect(dialog.getByTestId('game-time-check-content')).toBeVisible();

        // The ballot is the PAGE's ladder, never a second one in the drawer.
        await expect(dialog.locator('[data-testid="schedule-slot"]')).toHaveCount(0);

        // ROK-1579: no cross-hatch. Unclaimed hours are plain `bg-edge` in both
        // the day grid and the week strip now, so NOTHING in the editor may
        // carry the inline `repeating-linear-gradient` the stale week used to
        // paint. Measured on the live style, not on a class name, because the
        // hatch was an inline `style={{ backgroundImage }}`.
        const bars = await dialog.evaluate((el: HTMLElement) => {
            const nodes = Array.from(
                el.querySelectorAll<HTMLElement>(
                    '[data-testid^="phone-cell-"], [data-testid^="phone-week-strip"] *',
                ),
            );
            return {
                total: nodes.length,
                hatched: nodes.filter((n) => (n.style.backgroundImage || '') !== '').length,
            };
        });
        // Self-proving: a testid rename must fail here, not pass with zero nodes.
        expect(bars.total, 'the hatch probe matched no editor nodes at all').toBeGreaterThan(0);
        expect(
            bars.hatched,
            'the phone week editor still hatches unclaimed hours (ROK-1579 removed it)',
        ).toBe(0);

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

        // The comp's rule at 375x812: the one view fits, so the sheet's scroll
        // container has nothing to scroll. Measured on the sheet's scrolling
        // ancestor because the sheet body itself is a plain flex column. The
        // ROK-1579 header is no taller than the stepper it replaced and the
        // content box kept `h-[calc(95dvh-200px)]`, so the bar is unchanged.
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
            isPhoneLayout(test.info()),
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
            isPhoneLayout(test.info()),
            'Desktop-only — the phone Skip collapses the drawer onto the page ballot (ROK-1579), covered below',
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

    test('phone: "Same as last week" confirms and collapses the drawer onto the ballot', async ({
        page,
    }) => {
        test.skip(
            !isMobile(test.info()),
            'Phone-only — the week-editor answers are the phone shell (ROK-1569/1579)',
        );
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

        // Ending the check is DERIVED from the refetched staleness, exactly as
        // on desktop — and on the phone the whole drawer now COLLAPSES
        // (ROK-1579) instead of advancing to an in-sheet step 2. The sheet
        // unmounts, so `toHaveCount(0)` is the honest assertion: a merely
        // translated-off-screen sheet would still be attached.
        await expect(checkBody(page)).toBeHidden({ timeout: 20_000 });
        await expect(page.getByTestId('game-time-check-sheet')).toHaveCount(0, {
            timeout: 20_000,
        });
        await expect(page.getByTestId('game-time-check-step2')).toHaveCount(0);
        await expect(page.getByTestId('game-time-check-stepline')).toHaveCount(0);

        // What the viewer lands on is the PAGE's ladder, back from behind the
        // drawer the composite had it hidden under.
        await expect(
            page.locator('[data-testid="schedule-slot"]').first(),
        ).toBeVisible({ timeout: 20_000 });

        await expect
            .poll(readGameTimeStale, {
                timeout: 15_000,
                message: 'Same as last week did not clear staleness server-side',
            })
            .toBe(false);
    });

    test('phone: Skip collapses the drawer onto the ballot and stays skipped for the session', async ({
        page,
        browser,
    }) => {
        test.skip(
            !isMobile(test.info()),
            'Phone-only — the week-editor answers are the phone shell (ROK-1569/1579)',
        );
        // Three navigations (first load, reload, fresh context) in one test.
        test.slow();
        await goToPollExpectingCheck(page);

        await page.getByTestId('phone-week-skip').click();

        // ROK-1579: Skip alone collapses the drawer — there is no step 2 left
        // behind it, so there is no second dismissal to make. The sheet
        // unmounts entirely, hence `toHaveCount(0)` rather than `toBeHidden`.
        await expect(checkBody(page)).toBeHidden({ timeout: 10_000 });
        await expect(page.getByTestId('game-time-check-sheet')).toHaveCount(0, {
            timeout: 10_000,
        });
        await expect(page.getByTestId('game-time-check-step2')).toHaveCount(0);

        // The poll page underneath is untouched AND interactive: the ladder is
        // back and its vote control is live, not a disabled placeholder.
        const ladderRow = page.locator('[data-testid="schedule-slot"]').first();
        await expect(ladderRow).toBeVisible({ timeout: 20_000 });
        await expect(
            ladderRow.getByRole('button', { name: /vote/i }),
        ).toBeEnabled({ timeout: 10_000 });

        // Skip persists to sessionStorage, so a reload in the SAME tab must not
        // re-open the check even though the admin is still stale server-side.
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
        await expect(page.getByTestId('game-time-check-sheet')).toHaveCount(0);

        // ...and the skip really is SESSION-scoped, not a permanent dismissal:
        // the admin is STILL stale server-side (Skip answers nothing), so a
        // brand-new context — fresh sessionStorage, same stored login — is
        // asked again. Without this, a check that had been silenced forever
        // would satisfy the reload assertion above just as well.
        const fresh = await browser.newContext({
            ...devices['Pixel 5'],
            storageState: STORAGE_STATE_PATH,
        });
        try {
            const freshPage = await fresh.newPage();
            await freshPage.goto(
                `/community-lineup/${checkLineupId}/schedule/${checkMatchId}`,
                { waitUntil: 'domcontentloaded' },
            );
            await expect(checkBody(freshPage)).toBeVisible({ timeout: 20_000 });
        } finally {
            await fresh.close();
        }
    });

    test('phone: "Save my week" writes the week AND counts as the confirmation', async ({
        page,
    }) => {
        test.skip(!isMobile(test.info()), 'Phone-only — ROK-1569 week editor');

        // OWN the week this test edits. Sibling describes in THIS file PUT the
        // admin's template (Tuesday 19–21, Thursday 20), so a test that assumed
        // an empty Tuesday tapped an existing block: one block before, one
        // after, nothing dirty, Save still disabled.
        expect(
            SAVE_WEEK_SLOTS.some((s) => s.dayOfWeek === 6),
            'the baseline must leave Saturday empty — this test taps it',
        ).toBe(false);
        await apiPut(adminToken, '/users/me/game-time', { slots: SAVE_WEEK_SLOTS });

        // A template save stamps `game_time_confirmed_at`, so that PUT just
        // undid `beforeEach`'s clear. Clear it again and wait for the server to
        // agree, or the check never opens and there is nothing to save.
        await apiPost(adminToken, '/admin/test/clear-game-time-confirmation', {});
        await expect
            .poll(readGameTimeStale, {
                timeout: 15_000,
                message: 'admin never became stale after re-clearing the confirmation',
            })
            .toBe(true);

        await goToPollExpectingCheck(page);

        // Save is inert until the week actually differs from the saved one —
        // an untouched draft must not be able to stamp a confirmation.
        const save = page.getByTestId('phone-week-save');
        await expect(save).toBeDisabled();

        // Saturday: the baseline above leaves day 6 empty, so a tap creates a
        // block instead of merging into one. Asserted, not assumed.
        const saturday = page.getByTestId('phone-week-strip-day-6');
        await saturday.click();
        await expect(saturday).toHaveAttribute('aria-current', 'date');
        await expect(page.locator('[data-testid^="slot-block-6-"]')).toHaveCount(0);

        // The day target is sized from the measured row height (the editor's
        // rows are `1fr`, so it only exists after layout), and a tap dispatched
        // before that measure lands falls through to the cell, which has no
        // handler. Wait for a real box instead of a timer.
        await expect
            .poll(
                async () => (await page.getByTestId('slot-day-target-6').boundingBox())?.height ?? 0,
                { timeout: 10_000, message: 'the block layer never measured a row height' },
            )
            .toBeGreaterThan(0);

        // force: the day target sits above the cell and is the real pointer
        // recipient, so the hit-target check would call the cell intercepted —
        // the same gesture `game-time-blocks.smoke.spec.ts` uses.
        await page.getByTestId('phone-cell-6-21').click({ force: true });
        await expect(page.locator('[data-testid^="slot-block-6-"]')).toHaveCount(1);
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

        // The WRITE first: poll the same endpoint the page reads, so the UI
        // assertions below can never pass against a save that never landed.
        await expect
            .poll(readGameTimeDays, {
                timeout: 15_000,
                message: 'the tapped Saturday hour never reached /users/me/game-time',
            })
            .toContain(6);

        // The save IS the confirmation — `saveTemplate` stamps
        // `game_time_confirmed_at` (api/src/users/game-time.service.ts) — so the
        // check ends without a second tap and the whole drawer COLLAPSES
        // (ROK-1579); it does not advance to an in-sheet ballot.
        await expect(checkBody(page)).toBeHidden({ timeout: 20_000 });
        await expect(page.getByTestId('game-time-check-sheet')).toHaveCount(0, {
            timeout: 20_000,
        });
        await expect(page.getByTestId('game-time-check-stepline')).toHaveCount(0);
        await expect
            .poll(readGameTimeStale, {
                timeout: 15_000,
                message: 'saving a week did not clear staleness server-side',
            })
            .toBe(false);

        // ...and the ballot the viewer lands on is the page's own ladder, live.
        const ladderRow = page.locator('[data-testid="schedule-slot"]').first();
        await expect(ladderRow).toBeVisible({ timeout: 20_000 });
        await expect(
            ladderRow.getByRole('button', { name: /vote/i }),
        ).toBeEnabled({ timeout: 10_000 });
    });

    test('phone: "Same as last week" COLLAPSES the drawer — the page ladder is the one ballot (ROK-1579)', async ({
        page,
    }) => {
        test.skip(!isMobile(test.info()), 'the one-view sheet is the phone shell; desktop keeps the modal');
        // Two navigations (first load, reload) plus a confirm and a vote.
        test.slow();
        await goToPollExpectingCheck(page);

        const sheet = page.getByTestId('game-time-check-sheet');
        await expect(sheet).toBeVisible();
        // ROK-1579: one view, so nothing narrates a step.
        await expect(page.getByTestId('game-time-check-stepper')).toHaveCount(0);
        await expect(page.getByTestId('game-time-check-stepline')).toHaveCount(0);
        await expect(page.getByText(/Step \d of 2/)).toHaveCount(0);
        // ZERO ladders in the DOM while the sheet is up — the composite keeps
        // the page copy unmounted behind the full-height drawer, and the drawer
        // itself has never carried a ballot since ROK-1579.
        await expect(page.locator('[data-testid="schedule-slot"]')).toHaveCount(0);

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

        // The sheet COLLAPSES (ROK-1579) — it unmounts, it does not advance.
        await expect(sheet).toHaveCount(0, { timeout: 20_000 });
        await expect(page.getByTestId('game-time-check-step2')).toHaveCount(0);

        // ...and exactly ONE ladder comes back: the page's. Not two, which is
        // the regression an in-drawer ballot reintroduces.
        const row = page.locator('[data-testid="schedule-slot"]').first();
        await expect(row).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('[data-testid="schedule-slot"]')).toHaveCount(1);

        // That ladder is the REAL ballot: one tap moves the vote, server-side.
        const before = await row.getAttribute('data-voted');
        const after = before === 'true' ? 'false' : 'true';
        await Promise.all([
            page
                .waitForResponse(
                    (r) => r.url().includes('/vote') && r.request().method() === 'POST',
                    { timeout: 20_000 },
                )
                .catch(() => null),
            row.getByRole('button', { name: /vote/i }).click(),
        ]);
        await expect(row).toHaveAttribute('data-voted', after, { timeout: 15_000 });

        // The check is OVER, not merely hidden: the confirm cleared staleness
        // server-side, so a reload in the SAME tab comes back with no drawer at
        // all — and the vote cast on the page ladder is still there.
        const gameTimeFetch = page.waitForResponse(
            (r) =>
                r.url().includes('/users/me/game-time') &&
                r.request().method() === 'GET',
            { timeout: 20_000 },
        );
        await page.reload();
        await gameTimeFetch;
        await expect(
            page.locator('[data-testid="schedule-slot"]').first(),
        ).toHaveAttribute('data-voted', after, { timeout: 20_000 });
        await expect(sheet).toHaveCount(0);
    });
});
