/**
 * Lineup Creation & Phase Scheduling smoke tests (ROK-946).
 *
 * Tests the "Start Lineup" button on the Games page, the creation modal
 * with configurable duration fields, phase countdown display, force-advance
 * functionality, and the admin settings panel for default durations.
 *
 * Requires DEMO_MODE=true and an authenticated admin (global setup).
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, getAdminToken, apiGet, createLineupOrRetry } from './api-helpers';
import { isMobile } from './helpers';

// ROK-1147: this whole file asserts global state ("Start Lineup button visible
// when no active lineup exists"). With per-worker title-prefix isolation,
// sibling workers can hold their own lineups concurrently and the banner
// shows their lineup, masking the Start Lineup button. Run serially so only
// one worker exercises this file at a time.
test.describe.configure({ mode: 'serial' });

/** Local apiPatch that returns raw Response (used by this file's callers). */
async function apiPatch(
    token: string,
    path: string,
    body: Record<string, unknown>,
) {
    return fetch(`${API_BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
}

/**
 * A grid item's column span from its computed `grid-column-start` / `-end`
 * ('span N' -> N, 'auto' -> 1). When both are spans CSS ignores the end one.
 * Throws on explicit line placement, which {@link replayGridPlacement} cannot
 * model.
 */
function columnSpan(start: string, end: string): number {
    const spanOf = (v: string): number =>
        v === 'auto' ? 1 : Number(/^span (\d+)$/.exec(v)?.[1] ?? NaN);
    const span = start === 'auto' ? spanOf(end) : spanOf(start);
    if (Number.isNaN(span)) {
        throw new Error(`preset cell is not auto-placed: ${start} / ${end}`);
    }
    return span;
}

/**
 * Replays CSS grid row-flow auto-placement (no `dense`, no explicit lines) of
 * cells with the given column spans into `cols` tracks. An item that does not
 * fit the rest of its row wraps and strands those cells; whatever is left of
 * the last row after the final item is stranded too.
 *
 * @returns Each item's row index, and how many cells were left empty.
 */
function replayGridPlacement(
    cols: number,
    spans: readonly number[],
): { rows: number[]; emptyCells: number } {
    const rows: number[] = [];
    let row = 0;
    let cursor = 0;
    let emptyCells = 0;
    for (const span of spans) {
        if (cursor > 0 && cursor + span > cols) {
            emptyCells += cols - cursor;
            row += 1;
            cursor = 0;
        }
        rows.push(row);
        cursor += span;
        if (cursor >= cols) {
            row += 1;
            cursor = 0;
        }
    }
    if (cursor > 0) emptyCells += cols - cursor;
    return { rows, emptyCells };
}

// ROK-1147: per-worker title prefix scopes /admin/test/reset-lineups so sibling
// workers don't archive each other's lineups mid-test.
const FILE_PREFIX = 'lineup-creation';
let workerPrefix: string;
let lineupTitle: string;

/**
 * Archive lineups owned by THIS worker (ROK-1147).
 *
 * `/admin/test/reset-lineups` (DEMO_MODE-only) only archives lineups whose
 * title starts with `workerPrefix`, so sibling workers are unaffected.
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
 * Ensure an active lineup exists with phase durations set.
 * Handles 409 race conditions by returning the existing lineup.
 */
async function ensureActiveLineup(
    token: string,
): Promise<number> {
    // ROK-1070: switched from bare POST /lineups + /lineups/banner fallback on
    // 409 to createLineupOrRetry. The fallback returned whatever active lineup
    // existed (possibly a sibling-worker row in voting/decided), making
    // subsequent phase assertions non-deterministic. The retry helper archives
    // sibling rows by prefix and re-POSTs, guaranteeing a fresh `building`
    // lineup for this worker.
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

// ROK-1147: initialise per-worker prefix + title before any describe-level
// `beforeAll` hooks run.
test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
});

// ---------------------------------------------------------------------------
// "Start Lineup" button visibility on Games page
// ---------------------------------------------------------------------------

test.describe('Start Lineup button on Games page', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('Games page shows lineup banner with countdown instead of Start Lineup when active', async ({ page }) => {
        // Ensure an active lineup exists -- create one if needed
        const banner = await apiGet(adminToken, '/lineups/banner');
        if (!banner || typeof banner.id !== 'number') {
            const createRes = await fetch(`${API_BASE}/lineups`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${adminToken}`,
                },
                body: JSON.stringify({ title: lineupTitle }),
            });
            expect(createRes.ok).toBe(true);
        }

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // When a lineup is active, the banner must show a phase countdown
        // (e.g., "Building - 23h remaining"). This only renders after
        // ROK-946 adds the phaseDeadline field and countdown display.
        await expect(page.getByText('COMMUNITY LINEUP')).toBeVisible({
            timeout: 15_000,
        });
        const countdown = page.getByText(/remaining/i);
        await expect(countdown).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Lineup creation modal with duration fields
// ---------------------------------------------------------------------------

test.describe('Lineup creation modal', () => {
    let adminToken: string;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
    });

    test('modal opens with duration fields pre-filled from admin defaults', async ({ page }) => {
        // ROK-1167: use the test-mode query param to open the modal directly.
        // Avoids racing on the global "no active lineup" banner state — sibling
        // workers may hold their own lineups, masking the Start Lineup button.
        await page.goto('/games?test=open-lineup-modal');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Modal should open with duration configuration fields
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        // ROK-1302 (operator review): the Preset chooser is the visible
        // match-shape control; Match Threshold + Votes per Player + phase
        // durations moved behind "More options". Expand before asserting them.
        await modal.getByText(/more options/i).click();

        // Match threshold slider lives under the expander now.
        const thresholdSlider = modal.locator('[data-testid="match-threshold"]');
        await expect(thresholdSlider).toBeVisible({ timeout: 5_000 });

        // Duration sliders for building and voting should be present
        const buildingDuration = modal.locator('[data-testid="building-duration"]');
        await expect(buildingDuration).toBeVisible({ timeout: 5_000 });

        const votingDuration = modal.locator('[data-testid="voting-duration"]');
        await expect(votingDuration).toBeVisible({ timeout: 5_000 });

        // Verify slider labels
        await expect(modal.getByText('More matches')).toBeVisible();
        await expect(modal.getByText('Fewer, larger matches')).toBeVisible();
    });

    test('submitting modal creates lineup and navigates to detail page', async ({ page }) => {
        // ROK-1167: pre-archive this worker's prior lineups so the POST inside
        // the modal succeeds (sibling-worker rows are scoped out by prefix).
        await archiveActiveLineup(adminToken);

        // ROK-1167: open the modal via test query param — no race on global banner.
        await page.goto('/games?test=open-lineup-modal');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        // Listen for the POST /lineups response while clicking submit
        const [apiResponse] = await Promise.all([
            page.waitForResponse(
                (r) => r.url().includes('/lineups') && r.request().method() === 'POST',
                { timeout: 15_000 },
            ),
            modal.getByRole('button', { name: /Create Lineup|Start|Submit/i }).click(),
        ]);

        if (apiResponse.status() === 201) {
            // UI creation succeeded — verify navigation to detail page
            await page.waitForURL(/\/community-lineup\/\d+/, { timeout: 15_000 });
        } else {
            // 409 race: another worker created a lineup. Navigate to it directly.
            const banner = await apiGet(adminToken, '/lineups/banner');
            expect(banner).toBeTruthy();
            await page.goto(`/community-lineup/${banner.id}`);
        }

        await expect(
            page.getByText(/Smoke Lineup|Lineup — /).first(),
        ).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Phase countdown display
// ---------------------------------------------------------------------------

test.describe('Phase countdown display', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        lineupId = await ensureActiveLineup(adminToken);
    });

    test('banner shows compact countdown with time remaining', async ({ page }) => {
        // Re-ensure active lineup in case another worker archived it
        lineupId = await ensureActiveLineup(adminToken);

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Banner should show compact countdown like "Building - 23h remaining"
        const countdown = page.getByText(/remaining/i);
        await expect(countdown).toBeVisible({ timeout: 15_000 });
    });

    test('detail page shows full countdown timer', async ({ page }) => {
        // Navigate to Games page then click through to lineup detail
        // (avoids stale lineupId from cross-project race)
        lineupId = await ensureActiveLineup(adminToken);

        await page.goto('/games');
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );

        // Click through to lineup detail via banner link.
        // ROK-1167: scope to .first() — under parallel CI load, OtherActiveLineups
        // (rendered below the banner) shows sibling workers' lineups as additional
        // matching links, breaking strict mode. The primary banner link is first
        // in DOM order.
        const bannerLink = page
            .getByRole('link', { name: /View Lineup|Lineup/i })
            .first();
        await expect(bannerLink).toBeVisible({ timeout: 15_000 });
        await bannerLink.click();
        await page.waitForURL(/\/community-lineup\/\d+/, { timeout: 10_000 });

        // Full countdown should be visible on the detail page
        const countdown = page.getByText(/remaining|countdown|time left/i);
        await expect(countdown).toBeVisible({ timeout: 10_000 });
    });
});

// ---------------------------------------------------------------------------
// Phase breadcrumb transitions (advance + revert)
// ---------------------------------------------------------------------------

// ROK-1323: the 4-phase breadcrumb was removed; advance/revert moved into the
// operator ⋮ menu (LineupOperatorMenu). These tests drive that menu.
test.describe('Operator ⋮ menu — phase transitions', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        lineupId = await ensureActiveLineup(adminToken);
    });

    async function openMenu(page: Page) {
        await page.getByTestId('lineup-operator-menu-trigger').click();
        await expect(page.getByTestId('lineup-operator-menu')).toBeVisible({ timeout: 5_000 });
    }

    test('menu offers Advance to Voting for operators', async ({ page }) => {
        await expect(async () => {
            lineupId = await ensureActiveLineup(adminToken);
            await page.goto(`/community-lineup/${lineupId}`);
            await expect(
                page.getByText(/Smoke Lineup|Lineup — /).first(),
            ).toBeVisible({ timeout: 5_000 });
            await openMenu(page);
            const advance = page.getByTestId('lineup-operator-menu-advance');
            await expect(advance).toBeVisible({ timeout: 5_000 });
            await expect(advance).toContainText(/Advance to Voting/i);
        }).toPass({ timeout: 30_000 });
    });

    test('Advance item opens modal and confirming advances the lineup', async ({ page }) => {
        await expect(async () => {
            lineupId = await ensureActiveLineup(adminToken);
            await page.goto(`/community-lineup/${lineupId}`);
            await expect(
                page.getByText(/Smoke Lineup|Lineup — /).first(),
            ).toBeVisible({ timeout: 5_000 });

            await openMenu(page);
            await page.getByTestId('lineup-operator-menu-advance').click();
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
            await expect(page.getByRole('heading', { name: /Advance to Voting/ })).toBeVisible({ timeout: 5_000 });
            await page.getByRole('button', { name: /^Advance to Voting$/ }).click();
            await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
        }).toPass({ timeout: 30_000 });

        // Status persisted to voting (badge removed with the legacy chrome).
        await expect(async () => {
            const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
            expect(detail?.status).toBe('voting');
        }).toPass({ timeout: 10_000 });
    });

    test('Revert item opens modal and confirming reverts the lineup', async ({ page }) => {
        await expect(async () => {
            lineupId = await ensureActiveLineup(adminToken);
            await apiPatch(adminToken, `/lineups/${lineupId}/status`, { status: 'voting' });

            await page.goto(`/community-lineup/${lineupId}`);
            await expect(
                page.getByText(/Smoke Lineup|Lineup — /).first(),
            ).toBeVisible({ timeout: 5_000 });

            await openMenu(page);
            await page.getByTestId('lineup-operator-menu-revert').click();
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
            await expect(page.getByRole('heading', { name: /Revert to Nominating/ })).toBeVisible({ timeout: 5_000 });
            await page.getByRole('button', { name: /^Revert to Nominating$/ }).click();
            await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
        }).toPass({ timeout: 30_000 });

        await expect(async () => {
            const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
            expect(detail?.status).toBe('building');
        }).toPass({ timeout: 10_000 });
    });

    // ROK-1441: the preset row grew from four options to five (LAN was added).
    // A naive five-into-four-columns layout strands Custom alone in a
    // half-empty final row, so assert the tiling at BOTH viewports: the grid
    // is 2-2-1 at mobile (Custom spanning both columns) and 3-2 at desktop.
    test('preset row shows five options with no orphaned trailing cell', async ({
        page,
    }, testInfo) => {
        await page.goto('/games?test=open-lineup-modal');
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        for (const key of ['lan', 'tonight', 'thisWeek', 'series', 'custom']) {
            await expect(
                modal.locator(`[data-testid="preset-${key}"]`),
            ).toBeVisible({ timeout: 5_000 });
        }

        // The tiling is read from the computed grid, never from pixels: the
        // old bounding-box checks (Custom flush within 2px of the row's right
        // edge) drifted ~8px on the fleet (font metrics or the modal open
        // animation; not pinned).
        const row = modal.getByRole('radiogroup', { name: 'Lineup preset' });
        const grid = await row.evaluate((el) => ({
            tracks: getComputedStyle(el).gridTemplateColumns,
            cells: Array.from(el.children).map((child) => ({
                testId: child.getAttribute('data-testid'),
                start: getComputedStyle(child).gridColumnStart,
                end: getComputedStyle(child).gridColumnEnd,
            })),
        }));
        expect(grid.cells.map((c) => c.testId)).toEqual([
            'preset-lan',
            'preset-tonight',
            'preset-thisWeek',
            'preset-series',
            'preset-custom',
        ]);
        const cols = grid.tracks.split(' ').length;
        const spans = grid.cells.map((c) => columnSpan(c.start, c.end));
        const { rows, emptyCells } = replayGridPlacement(cols, spans);
        const seriesRow = rows[3];
        const customRow = rows[4];

        // Every row is full: no option wraps early and none is left alone in
        // a half-empty final row.
        expect(
            emptyCells,
            `empty cells tiling spans [${spans.join(', ')}] into ${cols} columns`,
        ).toBe(0);

        // The preset grid keeps its own (sm/md) breakpoint — ROK-1584 moved only
        // the hero / poll / profile surfaces to 1024px — so the tablet project
        // (810px) sees the desktop 3-2 tiling here, not the phone 2-2-1.
        // Spans are pinned exactly (start-lineup-presets.tsx PRESET_OPTIONS):
        // a looser "fills the grid" check also passes when Custom shrinks to
        // a 1/3- or 1/6-width cell.
        if (isMobile(testInfo)) {
            // 2-col grid: Custom spans both columns on a line of its own.
            expect(cols).toBe(2);
            expect(spans).toEqual([1, 1, 1, 1, 2]);
            expect(customRow).toBe(seriesRow + 1);
        } else {
            // 6-col grid: three 1/3 cells, then Series and Custom share the
            // final row half-and-half.
            expect(cols).toBe(6);
            expect(spans).toEqual([2, 2, 2, 3, 3]);
            expect(customRow).toBe(seriesRow);
        }
    });

    // ROK-1441: Tonight is now same-day (5h a phase); the old 15-min shape
    // lives on LAN. Both must survive the round-trip into the duration fields.
    test('Tonight writes 5-hour phases and LAN keeps the 15-minute shape', async ({
        page,
    }) => {
        await page.goto('/games?test=open-lineup-modal');
        const modal = page.locator('[role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 15_000 });

        await modal.locator('[data-testid="preset-tonight"]').click();
        await modal.getByText(/more options/i).click();

        const building = modal.locator('[data-testid="building-duration-hours"]');
        const voting = modal.locator('[data-testid="voting-duration-hours"]');
        await expect(building).toHaveValue('5', { timeout: 5_000 });
        await expect(voting).toHaveValue('5');

        await modal.locator('[data-testid="preset-lan"]').click();
        await expect(building).toHaveValue('0.25', { timeout: 5_000 });
        await expect(voting).toHaveValue('0.25');
        // Sub-hour values still read honestly rather than rounding to a day.
        await expect(modal.getByText('15 min').first()).toBeVisible();
    });
});

// ROK-1060: removed the "Admin lineup duration settings" describe block —
// the admin panel and route have been deleted. New negative-assertion
// coverage lives in scripts/smoke/admin-lineup-defaults-removal.smoke.spec.ts.
