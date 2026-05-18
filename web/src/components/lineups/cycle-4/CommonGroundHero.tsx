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
import { useMemo, useState, type JSX } from 'react';
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
}

interface ThemedBuckets {
  owned: CommonGroundGameDto[];
  taste: CommonGroundGameDto[];
  trending: CommonGroundGameDto[];
}

/**
 * Reshuffle tiles within each themed bucket deterministically by seed.
 * Operator round-3 (2026-05-18): scoring is deterministic so refetch
 * returns the same response. Shuffling client-side produces visible
 * "new picks" feedback on every Regenerate click without burdening the
 * scoring layer with randomness. Seed=0 leaves the original score order
 * untouched on first render.
 */
function shuffleBuckets(buckets: ThemedBuckets, seed: number): ThemedBuckets {
  if (seed === 0) return buckets;
  const rotate = (arr: CommonGroundGameDto[]): CommonGroundGameDto[] => {
    if (arr.length <= 1) return arr;
    // Mulberry32-style LCG keyed by seed × bucket-length for stable
    // re-orderings — different seeds produce different tile orders but the
    // same seed always produces the same shuffle (avoids React-render flap).
    let s = (seed * 2654435761 + arr.length) >>> 0;
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      s = Math.imul(s ^ (s >>> 15), 2246822507);
      s = Math.imul(s ^ (s >>> 13), 3266489909);
      const r = (s ^ (s >>> 16)) >>> 0;
      const j = r % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return {
    owned: rotate(buckets.owned),
    taste: rotate(buckets.taste),
    trending: rotate(buckets.trending),
  };
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

function HeroHeader({
  inSearch,
  onRegenerate,
  onOpenSearch,
  isFetching,
}: {
  inSearch: boolean;
  /** In suggestions mode: refetch tiles. In search mode: exit back to suggestions. */
  onRegenerate: () => void;
  onOpenSearch: () => void;
  isFetching: boolean;
}): JSX.Element {
  // Uniform mobile-compliant button styling (Apple HIG / Material / WCAG 2.5.5):
  //   - 44px min tap target
  //   - text-sm (14px) body, font-medium
  //   - Filled emerald-tinted background + emerald border so the affordance
  //     reads clearly as a button on the dark Common Ground panel.
  //   - Hover state darkens. Disabled fades.
  //   - Stack full-width below the section title on sub-sm viewports;
  //     inline at sm+ where horizontal space permits.
  const btnCls =
    'min-h-[44px] text-sm font-medium text-emerald-100 bg-emerald-500/10 hover:bg-emerald-500/20 active:bg-emerald-500/30 border border-emerald-500/40 hover:border-emerald-500/70 rounded-md px-4 py-2 inline-flex items-center justify-center gap-2 flex-1 sm:flex-initial transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-3">
      <h2 className="text-lg sm:text-base font-semibold text-foreground">
        ✨ Common Ground
      </h2>
      {/* The whole button row is desktop-only (sm:+). On mobile the
          sticky JourneyHero hosts Search + Regenerate + Jump so a
          duplicate set in the CG header would be noise. */}
      <div className="hidden sm:flex items-center gap-2 sm:w-auto">
        {!inSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search the game library"
            data-testid="nominate-search-any"
            className={btnCls}
          >
            <SearchIcon />
            <span>Search</span>
          </button>
        )}
        {/* ROK-1297 round 5i: Regenerate dropped — Common Ground now
            renders all tiles per theme (no cap), so there's nothing to
            "regenerate" against. The button is preserved ONLY as a Back
            affordance while in search mode. */}
        {inSearch && (
          <button
            type="button"
            onClick={onRegenerate}
            aria-label="Back to Common Ground suggestions"
            className={btnCls}
          >
            <BackIcon />
            <span>Back</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Inline SVG icons — kept here so the buttons share visual weight. */
function SearchIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="w-4 h-4 stroke-current"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={11} cy={11} r={7} />
      <path d="m20 20-3-3" />
    </svg>
  );
}

function RegenerateIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="w-4 h-4 stroke-current"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function BackIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="w-4 h-4 stroke-current"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
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

export function CommonGroundHero(props: CommonGroundHeroProps): JSX.Element {
  const {
    canParticipate,
    onTileNominate,
    onTileOpenDrawer,
    mergedData,
    isLoading,
    aiSuggestionsByGameId,
    atCap,
  } = props;

  const tiles = useMemo(() => mergedData?.data ?? [], [mergedData]);
  const buckets = useMemo(() => bucketByTheme(tiles), [tiles]);
  const themedCount =
    buckets.owned.length + buckets.taste.length + buckets.trending.length;
  const useThemedLayout = themedCount > 0;

  return (
    <section
      data-testid="common-ground-hero"
      className="border border-edge rounded-lg bg-panel/30 p-3 mt-3"
    >
      <div className="flex items-center mb-3">
        <h2 className="text-lg sm:text-base font-semibold text-foreground">
          ✨ Common Ground
        </h2>
      </div>
      <SuggestionsBody
        isLoading={isLoading}
        tiles={tiles}
        buckets={buckets}
        useThemedLayout={useThemedLayout}
        canParticipate={canParticipate}
        atCap={atCap}
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
        nominatingId={null}
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
      nominatingId={null}
      onTileNominate={onTileNominate}
      onTileOpenDrawer={onTileOpenDrawer}
      aiSuggestionsByGameId={aiSuggestionsByGameId}
    />
  );
}

