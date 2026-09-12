/**
 * ROK-1525 — the Library filter row and the clickable card badges.
 *
 * Surfaces driven, as the admin viewer, on BOTH projects:
 *   • /games Discover tab — the 2 / 3 / 4 / 5+ chip row and the owners chip
 *   • a preset click → `?players=<key>` + a narrowed Discover grid + the
 *     null-semantics hint line
 *   • a reload of that URL → the same narrowed view (the URL-persistence AC)
 *   • a card's player badge → the same filter, WITHOUT the card's own click
 *     target firing
 *   • `Players are looking` + a preset composing into one URL
 *
 * ─── NO SERVER STATE ────────────────────────────────────────────────────────
 * This file writes nothing. The filters are client-side predicates over rows
 * the page already fetched (ROK-1525 decision: no endpoint param, no contract
 * change), so the desktop and mobile projects can run it concurrently without
 * the cross-project teardown rules `lfg-chips.smoke.spec.ts` needs. The single
 * read it makes — `GET /games/discover` — is the same request the page makes,
 * taken BEFORE any UI assertion so React Query's staleTime cannot serve a
 * different corpus than the one the expectations were derived from (the
 * ROK-1156 poll-the-API-first rule).
 *
 * ─── WHY THE FIXTURES ARE DERIVED, NOT SEEDED ───────────────────────────────
 * There is no seeder for IGDB player ranges, and the co-op fixtures
 * (`POST /admin/test/seed-cooptimus`) deliberately carry `player_count IS
 * NULL` — they are the *excluded* case, never the included one. So the corpus
 * is read from `/games/discover` and the spec picks the first preset that both
 * KEEPS at least one discover card and DROPS at least one. If no preset
 * discriminates, the fixture gate below fails loudly rather than skipping: a
 * green run on a corpus that cannot prove narrowing is worse than a red one.
 *
 * ─── THE FIXTURE IS WHAT EVERY PAYLOAD OF THE LOAD AGREES ABOUT ─────────────
 * Deriving it from a SEPARATE `GET /games/discover` is a time-of-check /
 * time-of-use gap, and it went red on the fleet exactly there: one call saw
 * `World of Warcraft Classic` with no IGDB `playerCount` (so the spec elected
 * it "the card the preset drops"), a call moments later saw it enriched to
 * `1-40` (so the preset legitimately KEPT it), and `expectCardGone` failed
 * with `expected 0, received 3` on a filter that was working correctly.
 *
 * Capturing "the" response the page made does NOT close that gap, because the
 * page makes the call TWICE per load: `useGamesDiscover` keys on
 * `useViewerCacheScope()` (`use-games-discover.ts`), which is `'anon'` until
 * `['auth','me']` resolves and the viewer id after — two query keys, two
 * fetches. Waiting for the first one hands the spec the PRE-auth corpus while
 * the grid goes on to render the post-auth one, so IGDB enrichment landing
 * between them reopens the exact same misclassification.
 *
 * So the corpus is now every `/games/discover` payload the load produced,
 * admitted only where they UNANIMOUSLY agree about a game's `playerCount`. A
 * game whose range changed mid-load is not evidence of anything and is simply
 * not eligible as a fixture; what survives is true of the grid whichever
 * payload won the race. The `beforeAll` poll survives as the availability gate
 * (ROK-1156: never assert against a grid whose source has not answered yet),
 * not as the source of the expectations.
 *
 * ─── AND THE CLASSIFICATION IS CHECKED AGAINST THE RENDERED GRID ────────────
 * `expectFilteredGridSupports` re-derives, from the DOM, that EVERY card the
 * filtered grid still shows satisfies the same predicate. A bare
 * `toHaveCount(0)` on one nominated card can only fail with a count; this
 * fails by NAME, so any future drift between this file's mirror of
 * `supportsPlayerCount` and the product's own says which game exposed it.
 *
 * ─── DUAL-GRID RULE (`games.smoke.spec.ts:144-153`) ─────────────────────────
 * The Discover rows render TWICE — `hidden md:block` carousels of
 * `UnifiedGameCard` (a `/games/:id` link) and `md:hidden` rows of `DrawerCard`
 * (a `Research <name>` button). Presence assertions therefore take the union of
 * both handles and scope to `:visible`; absence assertions take both handles
 * UNQUALIFIED, so a filtered-out game has to be gone from BOTH trees. Both are
 * scoped to the `discover-grid` container (`games-page-discover.tsx`) so the
 * claim they make is the one under test — gone from the FILTERED grid — rather
 * than a claim about every banner, prompt and carousel the route happens to
 * render around it.
 *
 * ─── ONE SURFACE HAS CLICKABLE BADGES, ON PURPOSE ───────────────────────────
 * Slice 4 put activation on `DrawerCard` only — i.e. the `md:hidden` Discover
 * rows. The desktop carousel renders `GameDiscoverCard` → `UnifiedGameCard`,
 * which ROK-1129 unifies and which was deliberately left inert. The badge test
 * below therefore asserts the click on mobile and asserts the DELIBERATE
 * ABSENCE on desktop, so the scope boundary is pinned rather than assumed.
 *
 * TDD: every assertion here fails on the pre-ROK-1525 tree — the chip testids,
 * the `players` param and the activatable badges do not exist there.
 */
import { test, expect } from './base';
import type { Page, Response } from '@playwright/test';
import { getAdminToken, apiGet, pollForCondition } from './api-helpers';

const HOOK_TIMEOUT_MS = 60_000;

const HINT = 'library-filter-hint';
const OWNERS_CHIP = 'owners-filter-chip';
const LFG_CHIP = 'lfg-filter-chip';
/** The Discover grid container — `DISCOVER_GRID_TESTID` in the page module. */
const DISCOVER_GRID = 'discover-grid';

/** The activatable player badge's accessible name (`DrawerCard.tsx`). */
const PLAYER_BADGE_PREFIX = 'Filter to games for ';

/**
 * The presets, mirrored from `library-filter.helpers.ts` rather than imported.
 * A smoke test that reads its expectations out of the module under test can
 * only ever agree with it; the duplication is the assertion.
 */
const PRESETS = [
    { key: '5plus', label: '5+', players: 5, openEnded: true },
    { key: '4', label: '4', players: 4, openEnded: false },
    { key: '3', label: '3', players: 3, openEnded: false },
    { key: '2', label: '2', players: 2, openEnded: false },
] as const;

type Preset = (typeof PRESETS)[number];

/** Every preset key, in the order the chip row renders them. */
const CHIP_KEYS = ['2', '3', '4', '5plus'] as const;

interface DiscoverGame {
    id: number;
    name: string;
    playerCount?: { min: number; max: number } | null;
}

/**
 * "supports N" — N falls inside the range; `5+` is the open-ended tail.
 *
 * An EXACT mirror of `supportsPlayerCount` in
 * `web/src/pages/games/library-filter.helpers.ts`. Smoke specs cannot import
 * from `web/src` (nothing under `scripts/smoke` does, and the Playwright
 * transpiler does not resolve it), and a test that read its expectations out
 * of the module under test could only ever agree with it — so the duplication
 * is deliberate, and `expectFilteredGridSupports` is what keeps the two
 * honest: it asserts this mirror against the grid the product actually
 * rendered. Change one, change the other.
 */
function supports(game: DiscoverGame, preset: Preset): boolean {
    const range = game.playerCount;
    if (range == null) return false;
    if (preset.openEnded) return range.max >= preset.players;
    return range.min <= preset.players && range.max >= preset.players;
}

/** A preset that both keeps and drops a discover card, plus one of each. */
interface Corpus {
    preset: Preset;
    kept: DiscoverGame;
    dropped: DiscoverGame;
    /** The agreed corpus the pair came out of — the drift guard reads it. */
    games?: DiscoverGame[];
}

/** A game's range, collapsed to a comparable token. `null` and absent agree. */
function rangeKey(game: DiscoverGame): string {
    const range = game.playerCount;
    return range == null ? 'none' : `${range.min}-${range.max}`;
}

/**
 * Flatten the discover rows to one entry per game id.
 *
 * A game repeats across rows, and the predicate the product applies is
 * per-ROW: `filterDiscoverRows` (`games-page.tsx`) runs `applyLibraryFilters`
 * over each row's own copy. So a spec that dedupes to "first occurrence wins"
 * is asserting a per-game claim about per-row data. Any id whose copies
 * disagree about the range is therefore DROPPED rather than resolved — it
 * cannot support a claim about every card the grid draws for it.
 */
function flatten(rows: { games: DiscoverGame[] }[]): DiscoverGame[] {
    const seen = new Map<number, DiscoverGame>();
    const conflicted = new Set<number>();
    for (const row of rows) {
        for (const game of row.games) {
            const first = seen.get(game.id);
            if (first === undefined) seen.set(game.id, game);
            else if (rangeKey(first) !== rangeKey(game)) conflicted.add(game.id);
        }
    }
    return [...seen.values()].filter((game) => !conflicted.has(game.id));
}

/**
 * The games EVERY payload of one page load agrees about, in the order the
 * payload the grid ended up with lists them. See the header: the load issues
 * two `/games/discover` calls (pre- and post-auth query key) and IGDB
 * enrichment can land between them, so only unanimous rows are fixtures.
 */
function agreedCorpus(payloads: DiscoverGame[][]): DiscoverGame[] {
    const latest = payloads[payloads.length - 1] ?? [];
    return latest.filter((game) =>
        payloads.every((payload) => {
            const seen = payload.find((other) => other.id === game.id);
            return seen !== undefined && rangeKey(seen) === rangeKey(game);
        }),
    );
}

/** A kept + dropped pair for ONE preset, or null when it cannot discriminate. */
function corpusFor(games: DiscoverGame[], preset: Preset): Corpus | null {
    const kept = games.find((g) => supports(g, preset));
    const dropped = games.find((g) => !supports(g, preset));
    return kept && dropped ? { preset, kept, dropped } : null;
}

function pickCorpus(games: DiscoverGame[]): Corpus | null {
    for (const preset of PRESETS) {
        const found = corpusFor(games, preset);
        if (found) return found;
    }
    return null;
}

/**
 * Start recording EVERY `GET /games/discover` this page makes. Returns the
 * awaiter: it settles the bodies already in flight and hands back one flattened
 * payload per call, oldest first. Installed BEFORE `goto` so the pre-auth call
 * cannot slip past it.
 */
function captureDiscover(page: Page): () => Promise<DiscoverGame[][]> {
    const bodies: Promise<DiscoverGame[] | null>[] = [];
    page.on('response', (res: Response) => {
        if (!res.url().includes('/games/discover') || res.status() !== 200) return;
        bodies.push(
            res
                .json()
                .then((body: { rows?: { games: DiscoverGame[] }[] }) => flatten(body.rows ?? []))
                .catch(() => null),
        );
    });
    return async () =>
        (await Promise.all(bodies)).filter((payload): payload is DiscoverGame[] => payload !== null);
}

/**
 * Navigate, and return the corpus every payload of THIS load agrees about —
 * see the time-of-check note in the module header. The `networkidle` barrier
 * is what makes "every payload" true: the page fires the discover call twice
 * (pre- and post-auth query key) and the second is the one the grid keeps, so
 * settling on the first would reintroduce the race this guards against. It is
 * a request barrier, not a sleep — the page is read-only, so idle means the
 * load has genuinely stopped fetching. `resolve` picks the pair out of that
 * corpus; it fails the test loudly rather than skipping when the rendered
 * corpus cannot prove a narrowing.
 */
async function openWithCorpus(
    page: Page,
    url: string,
    resolve: (games: DiscoverGame[]) => Corpus | null,
): Promise<Corpus> {
    const settled = captureDiscover(page);
    await openDiscover(page, url);
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    const payloads = await settled();
    expect(payloads.length, 'the page made no GET /games/discover call').toBeGreaterThan(0);
    const games = agreedCorpus(payloads);
    const picked = resolve(games);
    expect(
        picked,
        'the payload the grid rendered cannot prove a player preset narrows it',
    ).toBeTruthy();
    return { ...(picked as Corpus), games };
}

/** The `beforeAll` corpus: an availability gate, never an expectation source. */
let apiCorpus: Corpus;
let discoverSize: number;

/**
 * A card handle in EACH tree: the desktop link and the mobile tile button.
 * Both trees are always mounted — the one the viewport doesn't use is
 * CSS-hidden, not unmounted — so every assertion qualifies on `:visible`.
 */
function cardHandles(page: Page, game: DiscoverGame) {
    const grid = page.getByTestId(DISCOVER_GRID);
    const tile = `button[aria-label=${JSON.stringify(`Research ${game.name}`)}]`;
    /** Every copy the CURRENT viewport shows, whichever tree that is. */
    const shown = grid.locator(`a[href="/games/${game.id}"]:visible, ${tile}:visible`);
    return { shown, visible: shown.first() };
}

async function expectCardShown(page: Page, game: DiscoverGame): Promise<void> {
    await expect(cardHandles(page, game).visible).toBeVisible({ timeout: 20_000 });
}

/**
 * The mirror of `expectCardShown`: gone from the filtered grid the user sees.
 * Counting the hidden tree instead would fail on mobile, where the CSS-hidden
 * desktop carousel still carries the card the mobile grid never displays.
 */
async function expectCardGone(page: Page, game: DiscoverGame): Promise<void> {
    await expect(cardHandles(page, game).shown).toHaveCount(0, { timeout: 20_000 });
}

/**
 * The drift guard: EVERY card the filtered grid still shows must satisfy the
 * predicate, not just the one card the corpus nominated.
 *
 * `expectCardGone` can only ever fail with a count, which says nothing about
 * WHY — the `expected 0, received 3` that sent this file back twice was a
 * correctly-working filter and a mis-derived fixture, and the count could not
 * tell those apart. This reads the rendered grid back, resolves each visible
 * card to its row in the corpus, and names any card the predicate rejects. If
 * this file's mirror of `supportsPlayerCount` and the product's own ever drift,
 * this is the assertion that says which game exposed it.
 *
 * Both trees are covered: the desktop carousel's `/games/:id` link resolves by
 * id, the mobile `DrawerCard` tile by the name in its `Research …` label.
 */
async function expectFilteredGridSupports(page: Page, corpus: Corpus): Promise<void> {
    const games = corpus.games ?? [];
    const byId = new Map(games.map((game) => [`id:${game.id}`, game]));
    const byName = new Map(games.map((game) => [`name:${game.name}`, game]));
    const tokens = await page
        .getByTestId(DISCOVER_GRID)
        .locator('a[href^="/games/"]:visible, button[aria-label^="Research "]:visible')
        .evaluateAll((els) =>
            els.map((el) => {
                const label = el.getAttribute('aria-label');
                if (label?.startsWith('Research ')) return `name:${label.slice('Research '.length)}`;
                return `id:${(el.getAttribute('href') ?? '').replace('/games/', '')}`;
            }),
        );
    expect(tokens.length, 'the filtered grid rendered no cards to check').toBeGreaterThan(0);
    // A token with no row in the corpus is a card this spec cannot speak for
    // (a banner link, a game the agreed corpus excluded) — not an offender.
    const offenders = [...new Set(tokens)]
        .map((token) => byId.get(token) ?? byName.get(token))
        .filter((game): game is DiscoverGame => game !== undefined && !supports(game, corpus.preset))
        .map((game) => `${game.name} ${JSON.stringify(game.playerCount ?? null)}`);
    expect(
        offenders,
        `the grid filtered to "${corpus.preset.label}" still shows cards the predicate rejects`,
    ).toEqual([]);
}

function chip(page: Page, key: string) {
    return page.getByTestId(`player-count-chip-${key}`);
}

/** `?players=<key>` present, whatever else the query string carries. */
function playersParam(key: string): RegExp {
    return new RegExp(`[?&]players=${key}(&|$)`);
}

/** Open the Discover tab and fail fast on an error boundary. */
async function openDiscover(page: Page, url = '/games'): Promise<void> {
    await page.goto(url);
    await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
        timeout: 15_000,
    });
}

test.beforeAll(async () => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    const token = await getAdminToken();
    // Poll the page's OWN source before any UI assertion (ROK-1156): the
    // expectations below are derived from this payload, so it has to be the
    // payload the grid will render.
    const discover = await pollForCondition(
        async () => {
            const res = (await apiGet(token, '/games/discover')) as {
                rows?: { games: DiscoverGame[] }[];
            } | null;
            return res?.rows?.some((r) => r.games.length > 0) ? res : null;
        },
        { timeoutMs: 30_000, description: 'GET /games/discover returns a non-empty row' },
    );
    const games = flatten(discover.rows ?? []);
    discoverSize = games.length;
    apiCorpus = pickCorpus(games) as Corpus;
});

// ---------------------------------------------------------------------------
// Fixture gate — a TEST, not a `beforeAll` throw, so one corpus problem cannot
// abort the file and hide every UI assertion behind it.
// ---------------------------------------------------------------------------

test('fixture: the discover corpus can prove a player preset narrows it', () => {
    expect(discoverSize, 'the discover rows must carry games').toBeGreaterThan(1);
    expect(
        apiCorpus,
        'no preset both keeps and drops a discover card — the corpus cannot prove narrowing',
    ).toBeTruthy();
    expect(apiCorpus.kept.playerCount, 'the kept fixture needs an IGDB range').toBeTruthy();
    expect(supports(apiCorpus.kept, apiCorpus.preset)).toBe(true);
    expect(supports(apiCorpus.dropped, apiCorpus.preset)).toBe(false);
});

// ---------------------------------------------------------------------------
// The chip row
// ---------------------------------------------------------------------------

test.describe('Game Library — the player-count chip row', () => {
    test('a preset click writes the URL, narrows the grid and discloses the drop', async ({
        page,
    }) => {
        const corpus = await openWithCorpus(page, '/games', pickCorpus);
        await expectCardShown(page, corpus.dropped);

        for (const key of CHIP_KEYS) await expect(chip(page, key)).toBeVisible();
        await expect(page.getByTestId(OWNERS_CHIP)).toBeVisible();
        await expect(chip(page, corpus.preset.key)).toHaveAttribute('aria-pressed', 'false');
        // The hint discloses a narrowing; with nothing narrowed it must be absent.
        await expect(page.getByTestId(HINT)).toHaveCount(0);

        await chip(page, corpus.preset.key).click();

        await expect(page).toHaveURL(playersParam(corpus.preset.key), { timeout: 10_000 });
        await expect(chip(page, corpus.preset.key)).toHaveAttribute('aria-pressed', 'true');
        // NULL semantics are disclosed, never silent (the ROK-1402 precedent).
        await expect(page.getByTestId(HINT)).toContainText('player-count');

        await expectCardShown(page, corpus.kept);
        await expectCardGone(page, corpus.dropped);
        await expectFilteredGridSupports(page, corpus);
    });

    test('reloading the filtered URL reproduces the filtered view', async ({ page }) => {
        // The preset is the `beforeAll` candidate; the kept/dropped pair is
        // re-derived from the payload THIS load rendered, so the expectations
        // and the grid cannot disagree about which card the preset drops.
        const { preset } = apiCorpus;
        const corpus = await openWithCorpus(page, `/games?players=${preset.key}`, (games) =>
            corpusFor(games, preset),
        );

        await expect(chip(page, corpus.preset.key)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId(HINT)).toBeVisible();
        await expectCardShown(page, corpus.kept);
        await expectCardGone(page, corpus.dropped);
        await expectFilteredGridSupports(page, corpus);
    });

    test('the preset composes with "Players are looking" in one URL', async ({ page }) => {
        const corpus = await openWithCorpus(page, '/games', pickCorpus);
        await expect(page.getByTestId(LFG_CHIP)).toBeVisible({ timeout: 20_000 });

        // Two chip writes back-to-back with NO barrier between them. Both
        // writers now resolve their patch against the params most recently
        // WRITTEN (`use-search-param-write.ts`), so a second click landing
        // before React has committed the first is no longer handed a stale
        // `prev` that drops it — the desktop flake of 2026-09-12
        // (`players=5plus` → `?lfg=1`, the preset silently gone) was that race,
        // and it is fixed rather than stepped around. The barrier that used to
        // sit here would hide the very regression this test exists to catch.
        await chip(page, corpus.preset.key).click();
        await page.getByTestId(LFG_CHIP).click();

        // Both narrowings live in the URL at once.
        await expect(page).toHaveURL(/[?&]lfg=1(&|$)/, { timeout: 10_000 });
        await expect(page).toHaveURL(playersParam(corpus.preset.key));
        await expect(page.getByTestId(LFG_CHIP)).toHaveAttribute('aria-pressed', 'true');

        // ROK-1525 B1: the `lfg=1` view is built from LFG group rows, which
        // carry neither player-count nor ownership data, so the library row is
        // HIDDEN there rather than left rendering pressed chips (and a
        // "showing only games with player-count data" hint) over a grid they
        // cannot narrow.
        await expect(chip(page, corpus.preset.key)).toHaveCount(0);
        await expect(page.getByTestId(OWNERS_CHIP)).toHaveCount(0);
        await expect(page.getByTestId(HINT)).toHaveCount(0);

        // Leaving the view brings the row back, still pressed: the param was
        // never dropped, only unrepresented while it could not apply.
        await page.getByTestId(LFG_CHIP).click();
        await expect(page).not.toHaveURL(/[?&]lfg=1(&|$)/, { timeout: 10_000 });
        await expect(chip(page, corpus.preset.key)).toHaveAttribute('aria-pressed', 'true');
    });
});

// ---------------------------------------------------------------------------
// The clickable card badge (DrawerCard only — see the module note)
// ---------------------------------------------------------------------------

/** `Filter to games for 5+ players` → the `5plus` chip key. */
function keyFromBadgeLabel(label: string): string {
    const shown = label.slice(PLAYER_BADGE_PREFIX.length).replace(/ players$/, '');
    return PRESETS.find((p) => p.label === shown)?.key ?? shown;
}

test.describe('Game Library — the card player badge as a filter', () => {
    test('a badge click filters the grid without opening the card', async ({ page }) => {
        const corpus = await openWithCorpus(page, '/games', pickCorpus);
        await expectCardShown(page, corpus.kept);

        const badges = page.locator(`button[aria-label^="${PLAYER_BADGE_PREFIX}"]:visible`);

        if (test.info().project.name !== 'mobile') {
            // DELIBERATE SCOPE (slice 4): the desktop carousel is
            // `UnifiedGameCard`, which ROK-1129 unifies and which was left
            // inert. Pinned rather than assumed — if activation ever spreads to
            // that surface, this line is the one that says so.
            await expect(badges).toHaveCount(0);
            // The desktop viewer is not stranded: the chip row is the control.
            await expect(chip(page, corpus.preset.key)).toBeVisible();
            return;
        }

        const badge = badges.first();
        await expect(badge).toBeVisible({ timeout: 20_000 });
        const key = keyFromBadgeLabel((await badge.getAttribute('aria-label')) ?? '');
        expect(CHIP_KEYS as readonly string[]).toContain(key);

        await badge.click();

        await expect(page).toHaveURL(playersParam(key), { timeout: 10_000 });
        // The card's own click target routes to /games/:id — it must NOT have
        // fired (`e.stopPropagation()` + `preventDefault()`, slice 4).
        await expect(page).not.toHaveURL(/\/games\/\d+/);
        await expect(chip(page, key)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId(HINT)).toBeVisible();
    });
});
