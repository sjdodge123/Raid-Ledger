/**
 * Cycle 4 Common Ground hero (ROK-1297, S1 Nominating composite).
 *
 * Replaces the single horizontal carousel of `CommonGroundPanel` with three
 * themed rows × four tiles, reusing the existing `CommonGroundGameCard`
 * (badges, AI Pick, sale %, owner / wishlist / player counts, early
 * access). Falls back to a single un-themed row when the server response
 * carries no `theme` field on any tile (deployment-skew safety net).
 *
 * Operator browser-test feedback 2026-05-18 (C): the hero owns an inline
 * `Search any game` mode that swaps its body for the library-search view
 * — no modal. State toggles via the header CTA.
 *
 * Pure presentational over `useCommonGround` — the parent passes
 * callbacks for nomination + drawer-open so the composite owns the
 * mutation state.
 */
import { useMemo, type JSX } from 'react';
import type {
  AiSuggestionDto,
  CommonGroundGameDto,
  CommonGroundResponseDto,
} from '@raid-ledger/contract';
import { CommonGroundThemedRow, CommonGroundTileWrapper } from './CommonGroundThemedRow';

export type CommonGroundMode = 'suggestions' | 'search';

export interface CommonGroundHeroProps {
  canParticipate: boolean;
  /** Fired when the user clicks the per-tile `+ Nominate` button. */
  onTileNominate: (gameId: number) => void;
  /** Fired when the user clicks the tile body (opens the U2 drawer). */
  onTileOpenDrawer: (gameId: number) => void;
  // ROK-1297 round 5l: state lifted to NominatingComposite so the sticky
  // JourneyHero can host the filter UI. CommonGroundHero is now purely
  // presentational over the data + flags it receives.
  mergedData: CommonGroundResponseDto | undefined;
  isLoading: boolean;
  aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
  atCap: boolean;
  /**
   * ROK-1297 round 5ag (Codex P2): id of the game currently mid-flight in
   * the useNominateGame mutation, or null. Threaded through every tile so
   * the clicked button immediately flips to "Adding…" and disables —
   * prevents double-tap duplicate nominations.
   */
  nominatingId: number | null;
}

interface ThemedBuckets {
  owned: CommonGroundGameDto[];
  taste: CommonGroundGameDto[];
  trending: CommonGroundGameDto[];
}

function bucketByTheme(tiles: CommonGroundGameDto[]): ThemedBuckets {
  const out: ThemedBuckets = { owned: [], taste: [], trending: [] };
  for (const t of tiles) {
    if (t.theme === 'owned') out.owned.push(t);
    else if (t.theme === 'taste') out.taste.push(t);
    else if (t.theme === 'trending') out.trending.push(t);
  }
  return out;
}

function LegacyFallbackRow({
  tiles,
  canParticipate,
  atCap,
  nominatingId,
  onTileNominate,
  onTileOpenDrawer,
  aiSuggestionsByGameId,
}: {
  tiles: CommonGroundGameDto[];
  canParticipate: boolean;
  atCap: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
  aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}): JSX.Element {
  return (
    <div
      data-testid="common-ground-fallback-row"
      className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
      style={{ scrollbarWidth: 'none' }}
    >
      {tiles.map((tile) => {
        const ai = aiSuggestionsByGameId.get(tile.gameId);
        return (
          <CommonGroundTileWrapper
            key={tile.gameId}
            tile={tile}
            disabled={!canParticipate}
            atCap={atCap}
            isNominating={nominatingId === tile.gameId}
            onNominate={onTileNominate}
            onOpenDrawer={onTileOpenDrawer}
            aiSuggested={!!ai}
            aiReasoning={ai?.reasoning}
          />
        );
      })}
    </div>
  );
}

/** ROK-1297 round 5i: cap removed. Common Ground now renders every tile
 *  the server returns so the user scrolls through the full catalogue
 *  instead of tapping a Regenerate button. The API still bounds the
 *  response size server-side. */

function ThemedLayout({
  buckets,
  canParticipate,
  atCap,
  nominatingId,
  onTileNominate,
  onTileOpenDrawer,
  aiSuggestionsByGameId,
}: {
  buckets: ThemedBuckets;
  canParticipate: boolean;
  atCap: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
  aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}): JSX.Element {
  return (
    <div className="space-y-6">
      {(['owned', 'taste', 'trending'] as const).map((theme) => (
        <CommonGroundThemedRow
          key={theme}
          theme={theme}
          tiles={buckets[theme]}
          atCap={atCap}
          canParticipate={canParticipate}
          nominatingId={nominatingId}
          onTileNominate={onTileNominate}
          onTileOpenDrawer={onTileOpenDrawer}
          aiSuggestionsByGameId={aiSuggestionsByGameId}
        />
      ))}
    </div>
  );
}

/**
 * "Suggested for you" row (ROK-1297 round 5s). The LLM returns up to ~5
 * top picks per lineup; rendering them as ambient badges on a 250-tile
 * grid made them effectively invisible. This row pulls those tiles up
 * to the top so the operator can find them at a glance. Uses the same
 * tile wrapper as the themed rows, so the violet ✨ AI Pick chip still
 * renders inside each card.
 */
function AiPicksRow({
  tiles,
  canParticipate,
  atCap,
  nominatingId,
  onTileNominate,
  onTileOpenDrawer,
  aiSuggestionsByGameId,
}: {
  tiles: CommonGroundGameDto[];
  canParticipate: boolean;
  atCap: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
  aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}): JSX.Element {
  return (
    <section
      role="region"
      aria-label="Suggested for you"
      data-testid="common-ground-ai-picks-row"
      className="space-y-2 mb-6 md:p-3 md:rounded-md md:border md:border-violet-500/40 md:bg-violet-500/5"
    >
      <h3 className="text-base sm:text-lg font-semibold text-foreground inline-flex items-center gap-2">
        <span aria-hidden="true">✨</span>
        Suggested for you
      </h3>
      <div className="grid gap-3 pb-2 [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))] md:[grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
        {tiles.map((tile) => {
          const ai = aiSuggestionsByGameId.get(tile.gameId);
          return (
            <CommonGroundTileWrapper
              key={tile.gameId}
              tile={tile}
              disabled={!canParticipate}
              atCap={atCap}
              isNominating={nominatingId === tile.gameId}
              onNominate={onTileNominate}
              onOpenDrawer={onTileOpenDrawer}
              aiSuggested
              aiReasoning={ai?.reasoning}
            />
          );
        })}
      </div>
    </section>
  );
}

export function CommonGroundHero(props: CommonGroundHeroProps): JSX.Element {
  const {
    canParticipate,
    onTileNominate,
    onTileOpenDrawer,
    mergedData,
    isLoading,
    aiSuggestionsByGameId,
    atCap,
    nominatingId,
  } = props;

  const allTiles = useMemo(() => mergedData?.data ?? [], [mergedData]);

  // ROK-1297 round 5s: AI picks are a Map keyed by gameId — the LLM's
  // top suggestions for this lineup. They were rendering AS BADGES on
  // whichever tile in the 258-tile grid they happened to fall on, which
  // made them effectively invisible to a scrolling user. Surface them
  // in a dedicated "Suggested for you" row at the top of Common Ground
  // so the operator can see what the LLM picked without hunting.
  const aiTiles = useMemo(
    () => allTiles.filter((t) => aiSuggestionsByGameId.has(t.gameId)),
    [allTiles, aiSuggestionsByGameId],
  );

  // ROK-1297 round 5ag (Codex P2): AI-promoted tiles already render in
  // the AiPicksRow at the top — filter them out of the main grid so the
  // same card doesn't appear twice with duplicated Nominate / drawer
  // affordances.
  const tiles = useMemo(
    () => allTiles.filter((t) => !aiSuggestionsByGameId.has(t.gameId)),
    [allTiles, aiSuggestionsByGameId],
  );
  const buckets = useMemo(() => bucketByTheme(tiles), [tiles]);
  const themedCount =
    buckets.owned.length + buckets.taste.length + buckets.trending.length;
  const useThemedLayout = themedCount > 0;

  return (
    <section
      data-testid="common-ground-hero"
      className="mt-3 md:border md:border-edge md:rounded-lg md:bg-panel/30 md:p-3"
    >
      <div className="flex items-center mb-3">
        <h2 className="text-lg sm:text-base font-semibold text-foreground">
          ✨ Common Ground
        </h2>
      </div>
      {aiTiles.length > 0 && (
        <AiPicksRow
          tiles={aiTiles}
          canParticipate={canParticipate}
          atCap={atCap}
          nominatingId={nominatingId}
          onTileNominate={onTileNominate}
          onTileOpenDrawer={onTileOpenDrawer}
          aiSuggestionsByGameId={aiSuggestionsByGameId}
        />
      )}
      <SuggestionsBody
        isLoading={isLoading}
        tiles={tiles}
        buckets={buckets}
        useThemedLayout={useThemedLayout}
        canParticipate={canParticipate}
        atCap={atCap}
        nominatingId={nominatingId}
        onTileNominate={onTileNominate}
        onTileOpenDrawer={onTileOpenDrawer}
        aiSuggestionsByGameId={aiSuggestionsByGameId}
      />
    </section>
  );
}

interface SuggestionsBodyProps {
  isLoading: boolean;
  tiles: CommonGroundGameDto[];
  buckets: ThemedBuckets;
  useThemedLayout: boolean;
  canParticipate: boolean;
  atCap: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
  aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}

function SuggestionsBody(props: SuggestionsBodyProps): JSX.Element {
  const {
    isLoading,
    tiles,
    buckets,
    useThemedLayout,
    canParticipate,
    atCap,
    nominatingId,
    onTileNominate,
    onTileOpenDrawer,
    aiSuggestionsByGameId,
  } = props;
  if (isLoading) {
    return <div className="text-[11px] text-muted">Loading suggestions…</div>;
  }
  if (tiles.length === 0) {
    return (
      <div className="text-[11px] text-muted py-4 text-center">
        No suggestions yet.
      </div>
    );
  }
  if (useThemedLayout) {
    return (
      <ThemedLayout
        buckets={buckets}
        canParticipate={canParticipate}
        atCap={atCap}
        nominatingId={nominatingId}
        onTileNominate={onTileNominate}
        onTileOpenDrawer={onTileOpenDrawer}
        aiSuggestionsByGameId={aiSuggestionsByGameId}
      />
    );
  }
  return (
    <LegacyFallbackRow
      tiles={tiles.slice(0, 12)}
      canParticipate={canParticipate}
      atCap={atCap}
      nominatingId={nominatingId}
      onTileNominate={onTileNominate}
      onTileOpenDrawer={onTileOpenDrawer}
      aiSuggestionsByGameId={aiSuggestionsByGameId}
    />
  );
}

