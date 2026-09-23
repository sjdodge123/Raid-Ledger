/**
 * AI suggestion blending into the Common Ground grid (ROK-1110).
 *
 * ROK-931 blended LLM picks straight into the Common Ground surface — a ✨ AI
 * Pick chip on tiles Common Ground already returned, and AI-only games
 * synthesised into the same grid as stubs — and shipped with no Playwright
 * coverage at all. This spec is the guard: a UI refactor that drops the chip,
 * loses the "Suggested for you" row, stops threading the LLM reasoning, or
 * breaks filter parity on AI-only stubs now fails here instead of in prod.
 *
 * ## No LLM is involved
 * `AiSuggestionsService` is a serve-stale-while-revalidate reader (ROK-1316):
 * it only reaches for a provider on the fully-cold path. A seeded
 * `lineup_ai_suggestions` row short-circuits ahead of that, so
 * `/admin/test/ai-suggestions/seed` gives a byte-deterministic payload with
 * no provider configured, no network call and no pre-gen job racing us.
 *
 * ## Concurrency
 * Desktop and mobile run as separate Playwright workers against ONE API, so
 * every mutable thing here is per-worker:
 *   - the lineup is created under `smoke-w{workerIndex}-ai-suggestions-` and
 *     reset by that prefix (ROK-1147 pattern);
 *   - the suggestions row is keyed to THAT lineup id, so the two workers can
 *     never read each other's fixture;
 *   - the AI-only stub is an invented game id offset per worker, so the two
 *     workers cannot pick the same catalogue row;
 *   - the nominate assertion polls THIS lineup's nominations only.
 * The one global write is enabling the `ai` plugin (install/activate, never
 * deactivated — see `enableAiSurface`); settings and the games catalogue are
 * untouched.
 *
 * ## Deviation from the story text
 * ROK-1110 asks for "hover the chip — tooltip surfaces the reasoning". That
 * is stale: ROK-1297 round 5z deliberately REMOVED the chip's `title` tooltip
 * on Common Ground cards (see `AiBadge` in `game-badges.tsx`, whose comment
 * forbids a fallback) and moved the reasoning to the `★ {reasoning}` line
 * under the tile. This spec asserts the as-built surface — the reasoning line
 * — and additionally pins the "no tooltip on the chip" decision so a future
 * change has to be deliberate.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import {
  apiGet,
  apiPost,
  awaitProcessing,
  cancelLineupPhaseJobs,
  createLineupOrRetry,
  getAdminToken,
  pollForCondition,
} from './api-helpers';
import {
  enableAiSurface,
  buildSuggestion,
  clearAiSuggestions,
  seedAiSuggestions,
} from './ai-suggestions-fixtures';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'ai-suggestions';

/**
 * Owner count given to the AI-only stub. Must clear the panel's DEFAULT
 * `minOwners` of 2 (see `CommonGroundFilters`) or the stub would be filtered
 * out before the test ever gets to assert it renders. The filter case then
 * raises the slider ABOVE this number to make it vanish.
 */
const STUB_OWNERS = 6;
/** Slider value that must hide a 6-owner stub. */
const FILTER_ABOVE_STUB = 9;

const BLEND_REASON = 'Blend pick: already common ground for this group';
const STUB_REASON = 'AI-only pick: never surfaced by Common Ground';

let workerPrefix: string;
let lineupTitle: string;
let stubGameName: string;

test.beforeAll(({}, testInfo) => {
  workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
  lineupTitle = `${workerPrefix}AI Blend`;
  stubGameName = `${workerPrefix}AI Only Stub`;
});

/** Open the lineup and wait for the Common Ground grid to have painted. */
async function openLineup(page: Page, lineupId: number): Promise<void> {
  await page.goto(`/community-lineup/${lineupId}`);
  await expect(
    page.getByTestId('common-ground-tile').first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** The tile whose card carries this game name. */
function tileFor(page: Page, gameName: string) {
  return page.getByTestId('common-ground-tile').filter({ hasText: gameName });
}

test.describe('AI suggestions blend into Common Ground', () => {
  let adminToken: string;
  let lineupId: number;
  /** A game Common Ground itself returns — the "blend" case. */
  let blendGameId: number;
  let blendGameName: string;
  /** A game Common Ground does NOT return — the AI-only stub case. */
  let stubGameId: number;

  test.beforeAll(async ({}, testInfo) => {
    adminToken = await getAdminToken();

    // The whole surface is gated on the `ai` plugin + the admin toggle. CI
    // boots with the plugin uninstalled, so enable it (no LLM needed — the
    // seeded cache row serves the read). The only skip left is an explicit
    // operator `ai_suggestions_enabled=false`, and its reason says so.
    const skipReason = await enableAiSurface(adminToken);
    test.skip(skipReason !== null, skipReason ?? '');

    await apiPost(adminToken, '/admin/test/reset-lineups', {
      titlePrefix: workerPrefix,
    });

    const created = await createLineupOrRetry(
      adminToken,
      {
        title: lineupTitle,
        buildingDurationHours: 720,
        votingDurationHours: 720,
        decidedDurationHours: 720,
      },
      workerPrefix,
    );
    lineupId = created.id;
    // Keep the lineup in `building` for the whole spec — the AI surface only
    // renders during nomination.
    await cancelLineupPhaseJobs(adminToken, lineupId);

    // Take the blend target from the REAL Common Ground response so the
    // "chip on a CG-present card" case cannot silently degrade into a second
    // AI-only stub if the grid's contents change.
    // NOTE: `CommonGroundQuerySchema` has no `lineupId` — this is a global
    // ownership-overlap query, and the panel scopes it by filters alone.
    // Passing one would be silently dropped, so don't imply it matters.
    const cg = await apiGet(adminToken, '/lineups/common-ground?minOwners=2');
    const rows: Array<{ gameId: number; gameName: string }> = cg?.data ?? [];
    test.skip(
      rows.length === 0,
      'SKIPPED — Common Ground returned no games (minOwners=2): this env has no seeded ownership overlap to blend into',
    );
    blendGameId = rows[0].gameId;
    blendGameName = rows[0].gameName;

    // The stub must be a game Common Ground did NOT return. An id far above
    // every real row, offset per worker, is both absent from `cg.data` and
    // unique to this worker.
    const present = new Set(rows.map((r) => r.gameId));
    stubGameId = 900_000 + testInfo.workerIndex * 1_000;
    while (present.has(stubGameId)) stubGameId += 1;

    await seedAiSuggestions(adminToken, lineupId, [
      buildSuggestion({
        gameId: blendGameId,
        name: blendGameName,
        reasoning: BLEND_REASON,
        communityOwnerCount: STUB_OWNERS,
        confidence: 0.95,
      }),
      buildSuggestion({
        gameId: stubGameId,
        name: stubGameName,
        reasoning: STUB_REASON,
        communityOwnerCount: STUB_OWNERS,
        confidence: 0.9,
      }),
    ]);
    await awaitProcessing(adminToken);
  });

  test.afterAll(async () => {
    if (!adminToken || !lineupId) return;
    await clearAiSuggestions(adminToken, lineupId);
    await apiPost(adminToken, '/admin/test/reset-lineups', {
      titlePrefix: workerPrefix,
    });
  });

  test('chips the CG-present card AND the AI-only stub', async ({ page }) => {
    await openLineup(page, lineupId);

    // Both picks are pulled into the dedicated "Suggested for you" row.
    const aiRow = page.getByTestId('common-ground-ai-picks-row');
    await expect(aiRow).toBeVisible();

    // The blend case: a game Common Ground returned on its own, now wearing
    // the chip. This is the assertion ROK-931 shipped uncovered.
    const blendTile = tileFor(page, blendGameName);
    await expect(blendTile.first()).toBeVisible();
    await expect(
      blendTile.first().getByText('✨ AI Pick'),
    ).toBeVisible();

    // The AI-only case: a game Common Ground never returned, synthesised into
    // the same grid as a stub and chipped identically.
    const stubTile = tileFor(page, stubGameName);
    await expect(stubTile.first()).toBeVisible();
    await expect(stubTile.first().getByText('✨ AI Pick')).toBeVisible();
  });

  test('surfaces the LLM reasoning on the ★ line, not a chip tooltip', async ({
    page,
  }) => {
    await openLineup(page, lineupId);

    // As-built surface (ROK-1297 round 5z): the reasoning reads under the
    // tile, and it is the AI reasoning rather than the generic whyReason.
    await expect(
      tileFor(page, stubGameName).first().getByText(STUB_REASON),
    ).toBeVisible();
    await expect(
      tileFor(page, blendGameName).first().getByText(BLEND_REASON),
    ).toBeVisible();

    // And the tooltip stays removed. ROK-1314 caught a `?? 'Suggested by AI'`
    // fallback silently re-adding it; this pins the decision.
    await expect(
      tileFor(page, stubGameName).first().getByText('✨ AI Pick'),
    ).not.toHaveAttribute('title', /.+/);
  });

  test('AI-only stub obeys the minOwners filter like every CG row', async ({
    page,
  }) => {
    await openLineup(page, lineupId);
    await expect(tileFor(page, stubGameName).first()).toBeVisible();

    // Raise Min owners above the stub's seeded community owner count. The
    // server applies this to real rows; `aiStubMatchesFilters` mirrors it for
    // stubs. If the mirror breaks, the stub survives a filter nothing else
    // survives — exactly the parity bug this case exists for.
    const minOwners = page.getByLabel('Min owners');
    await minOwners.fill(String(FILTER_ABOVE_STUB));
    await expect(tileFor(page, stubGameName)).toHaveCount(0);
  });

  test('nominating an AI-suggested card persists to the lineup', async ({
    page,
  }) => {
    await openLineup(page, lineupId);

    const blendTile = tileFor(page, blendGameName).first();
    await blendTile.getByTestId('common-ground-tile-nominate').click();

    // Poll the API, never the UI: React Query's staleTime will happily
    // re-render the pre-write fetch, so a DOM-only assertion here is a flake
    // generator (TESTING.md).
    await pollForCondition(
      async () => {
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        const entries: Array<{ gameId: number }> = detail?.entries ?? [];
        // Return the ENTRY, not a boolean: `pollForCondition` treats falsy as
        // "not ready", so a bare `false` would poll to timeout and report a
        // generic timeout rather than the missing nomination (helper contract).
        return entries.find((e) => e.gameId === blendGameId) ?? null;
      },
      { description: `lineup ${lineupId} entries to include AI pick ${blendGameId}` },
    );
  });
});
