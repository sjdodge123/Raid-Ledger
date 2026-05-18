/**
 * Cycle 4 Common Ground hero (ROK-1297, S1 Nominating composite).
 *
 * Replaces the single horizontal carousel of `CommonGroundPanel` with three
 * themed rows × four tiles. Falls back to a single un-themed row when the
 * server response carries no `theme` field on any tile (deployment-skew
 * safety net). Pure presentational over `useCommonGround` — the parent
 * passes callbacks for nomination + drawer-open so the composite owns the
 * mutation state.
 */
import { useMemo, useState, type JSX } from 'react';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { useCommonGround } from '../../../hooks/use-lineups';
import { CommonGroundHeroTile } from './CommonGroundHeroTile';
import { CommonGroundThemedRow } from './CommonGroundThemedRow';

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
}: {
  onRegenerate: () => void;
  onOpenWhy: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-sm font-semibold text-foreground">
        ✨ Common Ground
      </h2>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRegenerate}
          aria-label="Regenerate Common Ground suggestions"
          className="text-[11px] text-muted hover:text-foreground border border-edge rounded px-2 py-0.5"
        >
          ↻ Regenerate
        </button>
        <button
          type="button"
          onClick={onOpenWhy}
          aria-label="Why these suggestions?"
          className="text-[11px] text-muted hover:text-foreground border border-edge rounded px-2 py-0.5"
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
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
    >
      {tiles.map((tile) => (
        <CommonGroundHeroTile
          key={tile.gameId}
          game={tile}
          disabled={atCap || !canParticipate || nominatingId === tile.gameId}
          onNominate={() => onTileNominate(tile.gameId)}
          onOpenDrawer={() => onTileOpenDrawer(tile.gameId)}
        />
      ))}
    </div>
  );
}

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
    <div className="space-y-4">
      {(['owned', 'taste', 'trending'] as const).map((theme) =>
        buckets[theme].length === 0 ? null : (
          <CommonGroundThemedRow
            key={theme}
            theme={theme}
            tiles={buckets[theme].slice(0, 4)}
            atCap={atCap}
            canParticipate={canParticipate}
            nominatingId={nominatingId}
            onTileNominate={onTileNominate}
            onTileOpenDrawer={onTileOpenDrawer}
          />
        ),
      )}
    </div>
  );
}

export function CommonGroundHero(props: CommonGroundHeroProps): JSX.Element {
  const { lineupId, canParticipate, onTileNominate, onTileOpenDrawer } = props;
  const { data, isLoading, refetch } = useCommonGround(
    { minOwners: 0, lineupId },
    true,
  );
  const [whyOpen, setWhyOpen] = useState(false);

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
      />
      {isLoading && (
        <div className="text-[11px] text-muted">Loading suggestions…</div>
      )}
      {!isLoading && tiles.length === 0 && (
        <div className="text-[11px] text-muted py-4 text-center">
          No suggestions yet.
        </div>
      )}
      {!isLoading && useThemedLayout && (
        <ThemedLayout
          buckets={buckets}
          canParticipate={canParticipate}
          atCap={atCap}
          nominatingId={null}
          onTileNominate={onTileNominate}
          onTileOpenDrawer={onTileOpenDrawer}
        />
      )}
      {!isLoading && !useThemedLayout && tiles.length > 0 && (
        <LegacyFallbackRow
          tiles={tiles.slice(0, 12)}
          canParticipate={canParticipate}
          atCap={atCap}
          nominatingId={null}
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
