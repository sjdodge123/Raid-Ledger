/**
 * ROK-1478 AC6 — the two short paths into an LFG group page (desktop + mobile).
 *
 *   Flow A (§6.1)  /events banner            → /lfg/<slug>   in ≤ 2 clicks
 *   Flow B (§6.2)  /games "Players are looking" toggle → filtered grid →
 *                  the tile badge            → /lfg/<slug>
 *   Flow C (§6.3)  the toggle turns back OFF — the regression that could not
 *                  exist before this story, when the only way out of the
 *                  filtered view was the ✕ the toggle has now absorbed.
 *
 * ─── WHY THIS SPEC DERIVES ITS EXPECTATION RATHER THAN FORCING ONE GAME ─────
 * `GET /lfg` is COMMUNITY-WIDE: one row per game with a live intent, from any
 * user. `LfgSummaryBanner` branches on that global row count, so "exactly one
 * game is looking" is NOT achievable from a worker — and unlike the tile badge
 * (keyed by game, so a per-project game isolates it) a per-worker game cannot
 * fix a count. The desktop and mobile projects run concurrently against ONE
 * API, CI shards 5-way, and `lfg-chips.smoke.spec.ts:200-208` deliberately
 * leaves its intents in place because deleting them would pull state out from
 * under the sibling project.
 *
 * So this spec asserts the RULE and the CLICK COUNT, never a global count
 * (spec D6). §6.1 branches on the banner's OWN rendered `href` — which must be
 * exactly one of `/lfg/<slug>` or `/games?lfg=1`, never anything else — and
 * only THEN validates that choice against `GET /lfg`, bracketed by a read
 * either side of the render so a sibling seeding or withdrawing at the 1-vs-2
 * boundary cannot fail it. Reading the API first and predicting the branch (the
 * earlier shape) had the API and the DOM racing each other with nothing to
 * reconcile them. BOTH branches are ≤2 clicks, which is precisely what AC6
 * asks for.
 * The exact single-game href and copy are pinned deterministically one tier
 * down, in `web/src/components/events/lfg-summary-banner.test.tsx`, where MSW
 * controls the list exactly.
 *
 * Consequences, all deliberate:
 *   • Never assert `rows.length === 1`, and never assert a fixed tile count.
 *     The grid's "it really is filtered" property is asserted as a SHAPE in
 *     one atomic DOM snapshot instead — every tile in the `?lfg=1` grid is an
 *     LFG row, so every tile carries a badge. A library tile would not.
 *   • Never delete an intent this spec did not create. The `afterAll` removes
 *     exactly the admin's own intent on this project's own game.
 *   • Every UI assertion is gated behind a `GET /lfg` poll first — React
 *     Query's 15s `staleTime` will otherwise happily re-render a stale empty
 *     fetch (ROK-1156). Deterministic waits only; no `sleep()`.
 *
 * ─── SEEDING ────────────────────────────────────────────────────────────────
 * There is NO `/admin/test/*` LFG seeder endpoint and none may be added
 * (ROK-1453 D8 — re-verified on this branch: `grep -i lfg api/src/admin/`
 * returns only the slash-command test service). Intents are created through
 * the REAL `POST /lfg`, which is idempotent for an existing holder, so the
 * seed runs ONCE in `beforeAll` alongside the catalogue pick. It was in
 * `beforeEach`, which bought nothing — this file never withdraws the intent
 * until `afterAll`, and the intent is per-(user, game) so no sibling project
 * can revoke it — while adding a write between every test.
 *
 * The game is chosen PER PROJECT out of the discover catalogue, the same way
 * `lfg-group-page.smoke.spec.ts` does — at indices 2 and 3, because that spec
 * already owns 0 and 1 and mutates them. That keeps the badge click target and
 * the intent worker-private: LFG state is keyed by (user, game), so two
 * projects holding different games cannot withdraw each other's hands
 * mid-assertion. The `seed-cooptimus` trio is avoided for the same reason —
 * `lfg-chips.smoke.spec.ts` drives all three from both projects.
 */
import { test, expect } from './base';
import type { Locator, Page } from '@playwright/test';
import {
    getAdminToken,
    apiGet,
    apiPost,
    apiDelete,
    pollForCondition,
} from './api-helpers';

const HOOK_TIMEOUT_MS = 90_000;

const TILE = '[data-testid="lfg-looking-tile"]';
const CHIP = '[data-testid="lfg-chip"]';
const TOGGLE = 'lfg-filter-chip';
const BANNER = 'lfg-summary-banner';
const BANNER_CTA = 'lfg-summary-banner-cta';

/** The single-group banner: straight at the one game that is looking. */
const SINGLE_HREF = /^\/lfg\/[a-z0-9-]+$/;
/** The aggregate banner: through the LFG-filtered Library. */
const AGGREGATE_HREF = '/games?lfg=1';

/** desktop 2 / mobile 3 — 0 and 1 belong to `lfg-group-page.smoke.spec.ts`. */
const PROJECT_GAME_INDEX: Record<string, number> = { desktop: 2, mobile: 3 };

/** Only the `GET /lfg` fields this spec reads. */
interface LfgRow {
    gameId: number;
    gameSlug: string;
    activeCount: number;
}

let adminToken: string;
let gameId = 0;
let gameSlug = '';

/**
 * Catalogue games carrying a usable slug, in discover order. Both the banner
 * and the badge are slug-addressed, so a game without one is not reachable.
 */
async function pickGames(
    token: string,
): Promise<Array<{ id: number; slug: string }>> {
    const discover = await apiGet(token, '/games/discover');
    const seen = new Set<number>();
    const games: Array<{ id: number; slug: string }> = [];
    for (const row of discover?.rows ?? []) {
        for (const game of row.games ?? []) {
            if (!game?.id || typeof game.slug !== 'string' || !game.slug) continue;
            if (seen.has(game.id)) continue;
            seen.add(game.id);
            games.push({ id: game.id, slug: game.slug });
        }
    }
    return games;
}

/** Poll `GET /lfg` until the seeded intent is live, and return EVERY row. */
async function waitForSeededGroup(): Promise<LfgRow[]> {
    return pollForCondition(
        async () => {
            const rows = (await apiGet(adminToken, '/lfg')) as LfgRow[] | null;
            return rows?.some((r) => r.gameId === gameId) ? rows : null;
        },
        {
            timeoutMs: 20_000,
            description: `GET /lfg lists the seeded game ${gameId} (${gameSlug})`,
        },
    );
}

/** Counts the clicks a flow spends — the ≤2 budget IS the acceptance criterion. */
function clickCounter(): { click: (target: Locator) => Promise<void>; count: number } {
    let clicks = 0;
    return {
        async click(target: Locator): Promise<void> {
            clicks += 1;
            await target.click();
        },
        get count(): number {
            return clicks;
        },
    };
}

/** The `?lfg=1` grid tile for the seeded game, located by its own card link. */
function seededTile(page: Page): Locator {
    return page
        .locator(TILE)
        .filter({ has: page.locator(`a[href="/games/${gameId}"]`) });
}

/** That tile's badge, having first proved it is an anchor at the right slug. */
async function seededChip(page: Page): Promise<Locator> {
    const chip = seededTile(page).locator(CHIP).first();
    await expect(
        chip,
        `the ?lfg=1 grid shows the badge of the seeded game ${gameId}`,
    ).toBeVisible({ timeout: 20_000 });
    // AC4 — the badge is an anchor, and it names the group it opens.
    await expect(chip).toHaveAttribute('href', `/lfg/${gameSlug}`);
    return chip;
}

/** The destination both flows must reach. */
async function landOnGroupPage(page: Page, slug: string): Promise<void> {
    await expect(page).toHaveURL(new RegExp(`/lfg/${slug}$`), {
        timeout: 15_000,
    });
    await expect(page.getByTestId('lfg-status-bar')).toBeVisible({
        timeout: 15_000,
    });
}

test.beforeAll(async () => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    adminToken = await getAdminToken();
    // `test.info()` inside a hook is the shipped house pattern
    // (`lfg-chips.smoke.spec.ts:84`, read from `afterAll`), and it avoids the
    // empty-object-pattern the `({}, testInfo)` signature needs.
    const project = test.info().project.name;
    const index = PROJECT_GAME_INDEX[project];
    // Loud, not silent. An unregistered project used to fall back to index 0,
    // which is `lfg-group-page.smoke.spec.ts`'s game — this spec would then
    // quietly fight another spec for the same intent.
    if (index === undefined) {
        throw new Error(
            `lfg-discoverability: no catalogue index registered for Playwright ` +
                `project "${project}". Add one to PROJECT_GAME_INDEX — falling ` +
                `back to index 0 would collide with lfg-group-page.smoke.spec.ts.`,
        );
    }
    const games = await pickGames(adminToken);
    // Also loud. This was a `test.skip` in every test, so a catalogue too small
    // to isolate the projects produced a GREEN run in which nothing ran at all.
    expect(
        games.length,
        `the discover catalogue must expose more than ${index} slugged games ` +
            `for project "${project}" so this spec owns a game no other LFG ` +
            `spec touches`,
    ).toBeGreaterThan(index);
    const game = games[index];
    // Claimed here, before the first assertion, so `afterAll` can always
    // withdraw the hand this spec raised even if a test throws.
    gameId = game.id;
    gameSlug = game.slug;
    // Seeded ONCE: nothing between here and `afterAll` withdraws it, and the
    // intent is keyed by (user, game) so no sibling project can revoke it.
    await apiPost(adminToken, '/lfg', { gameId });
});

test.afterAll(async () => {
    if (!gameId) return;
    // Only ever OUR intent on OUR project's game — see the header.
    await apiDelete(adminToken, `/lfg/${gameId}`);
});

// ---------------------------------------------------------------------------
// 6.1 — the events banner is at most two clicks from the group page
// ---------------------------------------------------------------------------

test('the events banner reaches the group page in at most two clicks', async ({
    page,
}) => {
    const before = await waitForSeededGroup();
    const clicks = clickCounter();

    await page.goto('/events');
    const banner = page.getByTestId(BANNER);
    await expect(banner).toBeVisible({ timeout: 20_000 });

    // The banner's OWN href decides the branch. Whatever the community state,
    // it must be one of exactly two shapes — a third would be a routing bug
    // this spec has to fail on rather than skip past.
    const href = (await banner.getAttribute('href')) ?? '';
    const single = SINGLE_HREF.test(href);
    expect(
        single || href === AGGREGATE_HREF,
        `the events banner links either straight at one group (/lfg/<slug>) or at the filtered Library (${AGGREGATE_HREF}); it rendered "${href}"`,
    ).toBe(true);

    // Read again, so the two reads BRACKET the render. `single` claims the
    // banner saw one row, `aggregate` claims it saw two or more; a sibling
    // seeding or withdrawing at that boundary moves the count on one side of
    // the bracket only, and is tolerated. A banner that picked the wrong
    // branch against a count that never went near the boundary still fails.
    const after = ((await apiGet(adminToken, '/lfg')) ?? []) as LfgRow[];
    const counts = [before.length, after.length];

    if (single) {
        await expect(
            page.getByTestId(BANNER_CTA),
            'the single-group banner invites the viewer into that group',
        ).toHaveText('Join →');
        expect(
            Math.min(...counts),
            `the banner rendered the single-group href "${href}", so GET /lfg must have held exactly one group on at least one side of the render (saw ${counts.join(' then ')})`,
        ).toBe(1);
        expect(
            [...before, ...after].map((row) => row.gameSlug),
            `the group the banner names ("${href}") is one GET /lfg reports`,
        ).toContain(href.slice('/lfg/'.length));

        await clicks.click(banner);
        await landOnGroupPage(page, href.slice('/lfg/'.length));
    } else {
        await expect(
            page.getByTestId(BANNER_CTA),
            'the aggregate banner sends the viewer to browse the filtered Library',
        ).toHaveText('Browse them →');
        expect(
            Math.max(...counts),
            `the banner rendered the aggregate href, so GET /lfg must have held two or more groups on at least one side of the render (saw ${counts.join(' then ')})`,
        ).toBeGreaterThanOrEqual(2);

        // The seeded game's badge is the second and final click.
        await clicks.click(banner);
        await expect(page).toHaveURL(/\/games\?lfg=1$/, { timeout: 15_000 });
        await clicks.click(await seededChip(page));
        await landOnGroupPage(page, gameSlug);
    }

    expect(
        clicks.count,
        'AC6: the events banner is at most two clicks from the group page',
    ).toBeLessThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// 6.2 — the Games toggle filters the grid, and the badge opens the group
// ---------------------------------------------------------------------------

test('turning the looking filter on shows the looking games, and a badge opens one', async ({
    page,
}) => {
    await waitForSeededGroup();

    // AC1: the toggle is present with NO `lfg` param — before this story the
    // control did not render at all until the filter was already on.
    await page.goto('/games');
    const toggle = page.getByTestId(TOGGLE);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(
        toggle,
        'the toggle is unpressed on /games with no lfg param',
    ).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(page).toHaveURL(/[?&]lfg=1/, { timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const chip = await seededChip(page);

    // The grid really is the LFG list and not the Library: one atomic DOM
    // snapshot, so a sibling worker seeding mid-test cannot desynchronise the
    // two numbers. A plain library tile would carry no badge.
    const shape = await page.evaluate(
        (sel: { tile: string; chip: string }) => {
            const tiles = Array.from(document.querySelectorAll(sel.tile));
            return {
                tiles: tiles.length,
                withBadge: tiles.filter((t) => t.querySelector(sel.chip)).length,
            };
        },
        { tile: TILE, chip: CHIP },
    );
    expect(
        shape.tiles,
        'the filtered grid renders at least the seeded game',
    ).toBeGreaterThanOrEqual(1);
    expect(
        shape.withBadge,
        'every tile in the ?lfg=1 grid is an LFG row, so every one carries a badge',
    ).toBe(shape.tiles);

    await chip.click();
    await landOnGroupPage(page, gameSlug);
});

// ---------------------------------------------------------------------------
// 6.3 — the toggle round-trips (AC1's other half)
// ---------------------------------------------------------------------------

test('a deep link shows the filter pressed, and pressing it again returns discover', async ({
    page,
}) => {
    await waitForSeededGroup();

    await page.goto('/games?lfg=1');
    const toggle = page.getByTestId(TOGGLE);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(
        toggle,
        'a deep link to ?lfg=1 shows the toggle already pressed',
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(seededTile(page).first()).toBeVisible({ timeout: 20_000 });

    await toggle.click();
    await expect(page).not.toHaveURL(/[?&]lfg=1/, { timeout: 15_000 });
    await expect(
        toggle,
        'pressing the toggle again clears the filter',
    ).toHaveAttribute('aria-pressed', 'false');
    // The looking grid is unmounted, so the discover view rendered in its
    // place. Scoped to the heading role: the toggle's own label reads
    // "🎯 Players are looking" too.
    await expect(
        page.getByRole('heading', { name: 'Players are looking' }),
    ).toHaveCount(0);
    await expect(page.locator(TILE)).toHaveCount(0);
});
