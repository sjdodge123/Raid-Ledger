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
 * ─── DUAL-GRID RULE (`games.smoke.spec.ts:144-153`) ─────────────────────────
 * The Discover rows render TWICE — `hidden md:block` carousels of
 * `UnifiedGameCard` (a `/games/:id` link) and `md:hidden` rows of `DrawerCard`
 * (a `Research <name>` button). Presence assertions therefore take the union of
 * both handles and scope to `:visible`; absence assertions take both handles
 * UNQUALIFIED, so a filtered-out game has to be gone from BOTH trees. Nothing
 * else on this page links to `/games/:id` (the LFG prompt entries are buttons
 * and the lineup banner points at `/community-lineup/:id`), so neither handle
 * can be answered by something that is not a card.
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
import type { Page } from '@playwright/test';
import { getAdminToken, apiGet, pollForCondition } from './api-helpers';

const HOOK_TIMEOUT_MS = 60_000;

const HINT = 'library-filter-hint';
const OWNERS_CHIP = 'owners-filter-chip';
const LFG_CHIP = 'lfg-filter-chip';

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

/** "supports N" — N falls inside the range; `5+` is the open-ended tail. */
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
}

/** Flatten the discover rows, first occurrence wins (a game can repeat). */
function flatten(rows: { games: DiscoverGame[] }[]): DiscoverGame[] {
    const seen = new Map<number, DiscoverGame>();
    for (const row of rows) {
        for (const game of row.games) if (!seen.has(game.id)) seen.set(game.id, game);
    }
    return [...seen.values()];
}

function pickCorpus(games: DiscoverGame[]): Corpus | null {
    for (const preset of PRESETS) {
        const kept = games.find((g) => supports(g, preset));
        const dropped = games.find((g) => !supports(g, preset));
        if (kept && dropped) return { preset, kept, dropped };
    }
    return null;
}

let corpus: Corpus;
let discoverSize: number;

/** A card handle in EACH tree: the desktop link and the mobile tile button. */
function cardHandles(page: Page, game: DiscoverGame) {
    const tile = `button[aria-label=${JSON.stringify(`Research ${game.name}`)}]`;
    return {
        link: page.locator(`a[href="/games/${game.id}"]`),
        tile: page.locator(tile),
        /** The copy the CURRENT viewport shows, whichever tree that is. */
        visible: page.locator(`a[href="/games/${game.id}"]:visible, ${tile}:visible`).first(),
    };
}

async function expectCardShown(page: Page, game: DiscoverGame): Promise<void> {
    await expect(cardHandles(page, game).visible).toBeVisible({ timeout: 20_000 });
}

/** Unqualified on purpose: gone from the desktop tree AND the mobile tree. */
async function expectCardGone(page: Page, game: DiscoverGame): Promise<void> {
    const { link, tile } = cardHandles(page, game);
    await expect(link).toHaveCount(0, { timeout: 20_000 });
    await expect(tile).toHaveCount(0);
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
    corpus = pickCorpus(games) as Corpus;
});

// ---------------------------------------------------------------------------
// Fixture gate — a TEST, not a `beforeAll` throw, so one corpus problem cannot
// abort the file and hide every UI assertion behind it.
// ---------------------------------------------------------------------------

test('fixture: the discover corpus can prove a player preset narrows it', () => {
    expect(discoverSize, 'the discover rows must carry games').toBeGreaterThan(1);
    expect(
        corpus,
        'no preset both keeps and drops a discover card — the corpus cannot prove narrowing',
    ).toBeTruthy();
    expect(corpus.kept.playerCount, 'the kept fixture needs an IGDB range').toBeTruthy();
    expect(supports(corpus.kept, corpus.preset)).toBe(true);
    expect(supports(corpus.dropped, corpus.preset)).toBe(false);
});

// ---------------------------------------------------------------------------
// The chip row
// ---------------------------------------------------------------------------

test.describe('Game Library — the player-count chip row', () => {
    test('a preset click writes the URL, narrows the grid and discloses the drop', async ({
        page,
    }) => {
        await openDiscover(page);
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
    });

    test('reloading the filtered URL reproduces the filtered view', async ({ page }) => {
        await openDiscover(page, `/games?players=${corpus.preset.key}`);

        await expect(chip(page, corpus.preset.key)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId(HINT)).toBeVisible();
        await expectCardShown(page, corpus.kept);
        await expectCardGone(page, corpus.dropped);
    });

    test('the preset composes with "Players are looking" in one URL', async ({ page }) => {
        await openDiscover(page);
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
        await openDiscover(page);
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
