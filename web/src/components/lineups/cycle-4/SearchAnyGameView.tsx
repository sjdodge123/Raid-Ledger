/**
 * Inline search view (ROK-1297, B/C 2026-05-18) — replaces the themed
 * suggestion rows in `CommonGroundHero` when the user toggles search
 * mode. Pulls results from `useGameSearch` (the existing library
 * search behind `/games/search`) and maps each `GameDetailDto` onto
 * the tile shape used by `CommonGroundTileWrapper` so the per-tile
 * Nominate / drawer affordances stay identical.
 *
 * Lives in its own file so `CommonGroundHero.tsx` stays under the
 * 300-line cap.
 */
import { useMemo, useState, type JSX } from 'react';
import type {
  CommonGroundGameDto,
  GameDetailDto,
} from '@raid-ledger/contract';
import { useGameSearch } from '../../../hooks/use-game-search';
import { CommonGroundTileWrapper } from './CommonGroundThemedRow';

export interface SearchAnyGameViewProps {
  canParticipate: boolean;
  atCap: boolean;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
  onExit: () => void;
}

function detailToTile(g: GameDetailDto): CommonGroundGameDto {
  return {
    gameId: g.id,
    gameName: g.name,
    slug: g.slug,
    coverUrl: g.coverUrl,
    ownerCount: 0,
    wishlistCount: 0,
    nonOwnerPrice: g.itadCurrentPrice ?? null,
    itadCurrentCut: g.itadCurrentCut ?? null,
    itadCurrentShop: g.itadCurrentShop ?? null,
    itadCurrentUrl: g.itadCurrentUrl ?? null,
    itadLowestPrice: g.itadLowestPrice ?? null,
    earlyAccess: g.earlyAccess ?? false,
    itadTags: g.itadTags ?? [],
    playerCount: g.playerCount ?? null,
    score: 0,
  };
}

/**
 * Collapse DLC / edition variants returned by `/games/search` to the
 * single canonical row per "base game." ITAD surfaces every DLC bundle as
 * its own entry (e.g. `TMNT: Splintered Fate - Gold Edition`,
 * `... and Alopex Character`, etc.), which the operator flagged as
 * duplicates. We dedupe by everything before the first ` - ` / ` and `,
 * keeping the first hit (search is already sorted by relevance / rating).
 */
function dedupeByBaseName(rows: GameDetailDto[]): GameDetailDto[] {
  const seen = new Map<string, GameDetailDto>();
  for (const g of rows) {
    const base = g.name.split(/ - | and /i)[0].trim().toLowerCase();
    if (!seen.has(base)) seen.set(base, g);
  }
  return [...seen.values()];
}

export function SearchAnyGameView(props: SearchAnyGameViewProps): JSX.Element {
  const { canParticipate, atCap, onTileNominate, onTileOpenDrawer, onExit } =
    props;
  const [query, setQuery] = useState('');
  const { data, isFetching } = useGameSearch(query, query.length >= 2);

  const tiles = useMemo(
    () => dedupeByBaseName(data?.data ?? []).map(detailToTile),
    [data],
  );

  return (
    <div data-testid="search-any-game-view" className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search any game by name…"
        aria-label="Search the game library"
        data-testid="search-any-game-input"
        autoFocus
        className="w-full min-h-[44px] px-3 py-2 text-[13px] rounded border border-edge bg-overlay/30 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-emerald-300"
      />
      {/* The CommonGroundHero header swaps Regenerate for "← Back" while
          search mode is active — only one Back affordance, in a stable
          location. Operator feedback round 3 (2026-05-18). */}
      <SearchResultsBody
        query={query}
        isFetching={isFetching}
        tiles={tiles}
        canParticipate={canParticipate}
        atCap={atCap}
        onTileNominate={onTileNominate}
        onTileOpenDrawer={onTileOpenDrawer}
      />
    </div>
  );
}

interface ResultsBodyProps {
  query: string;
  isFetching: boolean;
  tiles: CommonGroundGameDto[];
  canParticipate: boolean;
  atCap: boolean;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
}

function SearchResultsBody(props: ResultsBodyProps): JSX.Element {
  const {
    query,
    isFetching,
    tiles,
    canParticipate,
    atCap,
    onTileNominate,
    onTileOpenDrawer,
  } = props;
  if (query.length < 2) {
    return (
      <p className="text-[12px] text-muted py-6 px-1 text-center">
        Type at least 2 characters to search the library.
      </p>
    );
  }
  if (isFetching && tiles.length === 0) {
    return (
      <p
        className="text-[12px] text-muted py-6 px-1 text-center"
        data-testid="search-any-game-loading"
      >
        Searching…
      </p>
    );
  }
  if (tiles.length === 0) {
    return (
      <p
        className="text-[12px] text-muted py-6 px-1 text-center"
        data-testid="search-any-game-empty"
      >
        No games matched “{query}”.
      </p>
    );
  }
  return (
    <div
      data-testid="search-any-game-results"
      className="flex flex-wrap gap-3 pb-2"
    >
      {tiles.map((tile) => (
        <CommonGroundTileWrapper
          key={tile.gameId}
          tile={tile}
          disabled={!canParticipate}
          atCap={atCap}
          isNominating={false}
          onNominate={onTileNominate}
          onOpenDrawer={onTileOpenDrawer}
        />
      ))}
    </div>
  );
}
