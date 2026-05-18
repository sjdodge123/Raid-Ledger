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
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { useCommonGround } from '../../../hooks/use-lineups';
import { CommonGroundThemedRow, CommonGroundTileWrapper } from './CommonGroundThemedRow';
import { SearchAnyGameView } from './SearchAnyGameView';

export interface CommonGroundHeroProps {
  lineupId: number;
  canParticipate: boolean;
  /** Fired when the user clicks the per-tile `+ Nominate` button. */
  onTileNominate: (gameId: number) => void;
  /** Fired when the user clicks the tile body (opens the U2 drawer). */
  onTileOpenDrawer: (gameId: number) => void;
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

function HeroHeader({
  onRegenerate,
  onOpenWhy,
  onOpenSearch,
  isFetching,
}: {
  onRegenerate: () => void;
  onOpenWhy: () => void;
  onOpenSearch: () => void;
  isFetching: boolean;
}): JSX.Element {
  const btnCls =
    'min-h-[36px] text-[11px] text-muted hover:text-foreground border border-edge rounded px-2 py-1 inline-flex items-center gap-1';
  return (
    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <h2 className="text-sm font-semibold text-foreground">
        ✨ Common Ground
      </h2>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search any game in the library"
          data-testid="nominate-search-any"
          className={btnCls}
        >
          🔍 Search any game
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={isFetching}
          aria-label="Regenerate Common Ground suggestions"
          aria-busy={isFetching}
          className={`${btnCls} disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {isFetching ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block w-3 h-3 border-2 border-emerald-300 border-t-transparent rounded-full animate-spin"
              />
              Regenerating…
            </>
          ) : (
            <>↻ Regenerate</>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenWhy}
          aria-label="Why these suggestions?"
          className={btnCls}
        >
          Why these?
        </button>
      </div>
    </div>
  );
}

function LegacyFallbackRow({
  tiles,
  canParticipate,
  atCap,
  nominatingId,
  onTileNominate,
  onTileOpenDrawer,
}: {
  tiles: CommonGroundGameDto[];
  canParticipate: boolean;
  atCap: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
}): JSX.Element {
  return (
    <div
      data-testid="common-ground-fallback-row"
      className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
      style={{ scrollbarWidth: 'none' }}
    >
      {tiles.map((tile) => (
        <CommonGroundTileWrapper
          key={tile.gameId}
          tile={tile}
          disabled={!canParticipate}
          atCap={atCap}
          isNominating={nominatingId === tile.gameId}
          onNominate={onTileNominate}
          onOpenDrawer={onTileOpenDrawer}
        />
      ))}
    </div>
  );
}

/** Operator-set ceiling per theme (B, 2026-05-18) — prevents a runaway
 *  response from rendering hundreds of tiles. The API caps the response
 *  set today; this is a UI-side belt-and-braces. */
const PER_THEME_CEILING = 24;

function ThemedLayout({
  buckets,
  canParticipate,
  atCap,
  nominatingId,
  onTileNominate,
  onTileOpenDrawer,
}: {
  buckets: ThemedBuckets;
  canParticipate: boolean;
  atCap: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
}): JSX.Element {
  return (
    <div className="space-y-6">
      {(['owned', 'taste', 'trending'] as const).map((theme) => (
        <CommonGroundThemedRow
          key={theme}
          theme={theme}
          tiles={buckets[theme].slice(0, PER_THEME_CEILING)}
          atCap={atCap}
          canParticipate={canParticipate}
          nominatingId={nominatingId}
          onTileNominate={onTileNominate}
          onTileOpenDrawer={onTileOpenDrawer}
        />
      ))}
    </div>
  );
}

export function CommonGroundHero(props: CommonGroundHeroProps): JSX.Element {
  const { lineupId, canParticipate, onTileNominate, onTileOpenDrawer } = props;
  const { data, isLoading, isFetching, refetch } = useCommonGround(
    { minOwners: 0, lineupId },
    true,
  );
  const [whyOpen, setWhyOpen] = useState(false);
  const [mode, setMode] = useState<'suggestions' | 'search'>('suggestions');

  const tiles = useMemo(() => data?.data ?? [], [data]);
  const buckets = useMemo(() => bucketByTheme(tiles), [tiles]);
  const themedCount =
    buckets.owned.length + buckets.taste.length + buckets.trending.length;
  const useThemedLayout = themedCount > 0;
  const atCap =
    (data?.meta.nominatedCount ?? 0) >= (data?.meta.maxNominations ?? 20);

  return (
    <section
      data-testid="common-ground-hero"
      className="border border-edge rounded-lg bg-panel/30 p-3 mt-3"
    >
      <HeroHeader
        onRegenerate={() => void refetch()}
        onOpenWhy={() => setWhyOpen(true)}
        onOpenSearch={() => setMode('search')}
        isFetching={isFetching}
      />
      {mode === 'search' ? (
        <SearchAnyGameView
          canParticipate={canParticipate}
          atCap={atCap}
          onTileNominate={onTileNominate}
          onTileOpenDrawer={onTileOpenDrawer}
          onExit={() => setMode('suggestions')}
        />
      ) : (
        <SuggestionsBody
          isLoading={isLoading}
          tiles={tiles}
          buckets={buckets}
          useThemedLayout={useThemedLayout}
          canParticipate={canParticipate}
          atCap={atCap}
          onTileNominate={onTileNominate}
          onTileOpenDrawer={onTileOpenDrawer}
        />
      )}
      {whyOpen && (
        <WhyTheseModal
          weights={data?.meta.appliedWeights}
          onClose={() => setWhyOpen(false)}
        />
      )}
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
    />
  );
}

function WhyTheseModal({
  weights,
  onClose,
}: {
  weights?: {
    ownerWeight: number;
    tasteWeight: number;
    socialWeight: number;
    intensityWeight: number;
    saleBonus: number;
    fullPricePenalty: number;
  };
  onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Why these suggestions"
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-edge rounded-lg max-w-md w-full mx-4 p-4 space-y-2"
      >
        <h3 className="text-sm font-semibold text-foreground">
          Why these suggestions?
        </h3>
        <p className="text-[12px] text-muted">
          Tiles are ranked by ownership in the group, your taste vector, and
          social signals (sales, wishlists).
        </p>
        {weights && (
          <ul className="text-[11px] text-muted space-y-1 list-none p-0">
            <li>Owners: {weights.ownerWeight}</li>
            <li>Taste: {weights.tasteWeight}</li>
            <li>Social: {weights.socialWeight}</li>
            <li>Intensity: {weights.intensityWeight}</li>
          </ul>
        )}
        <div className="text-right">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] px-2 py-0.5 border border-edge rounded text-muted hover:text-foreground"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
