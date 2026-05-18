/**
 * Single themed section (Owned / Taste / Trending) in the Common Ground
 * hero (ROK-1297). Reuses the existing CommonGroundGameCard (badges, AI
 * Pick, sale %, owner count, wishlist count, player count, early access)
 * and adds the per-tile `★ {whyReason}` annotation below each card.
 *
 * Operator browser-test feedback 2026-05-18 (B): tiles now flex-wrap into
 * multiple visual rows per theme rather than overflowing horizontally —
 * triples the on-screen game density. Empty themes render the label with
 * a single-line "(no suggestions in this category yet)" placeholder.
 */
import { type JSX } from 'react';
import type {
  AiSuggestionDto,
  CommonGroundGameDto,
  CommonGroundTheme,
} from '@raid-ledger/contract';
import { CommonGroundGameCard } from '../CommonGroundGameCard';

export interface CommonGroundThemedRowProps {
  theme: CommonGroundTheme;
  tiles: CommonGroundGameDto[];
  atCap: boolean;
  canParticipate: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
  aiSuggestionsByGameId: Map<number, AiSuggestionDto>;
}

const THEME_LABELS: Record<CommonGroundTheme, { title: string; aria: string }> =
  {
    owned: {
      title: 'Owned by your group',
      aria: 'Owned by your group',
    },
    taste: {
      title: 'Matches your taste',
      aria: 'Matches your taste',
    },
    trending: {
      title: 'Trending or on sale',
      aria: 'Trending or on sale',
    },
  };

export function CommonGroundThemedRow(
  props: CommonGroundThemedRowProps,
): JSX.Element {
  const {
    theme,
    tiles,
    atCap,
    canParticipate,
    nominatingId,
    onTileNominate,
    onTileOpenDrawer,
    aiSuggestionsByGameId,
  } = props;
  const meta = THEME_LABELS[theme];
  return (
    <section
      role="region"
      aria-label={meta.aria}
      data-testid={`common-ground-themed-row-${theme}`}
      className="space-y-2"
    >
      <h3 className="text-[12px] uppercase tracking-wider text-muted">
        {meta.title}
      </h3>
      {tiles.length === 0 ? (
        <p className="text-[11px] text-muted py-2 px-1 italic">
          (no suggestions in this category yet)
        </p>
      ) : (
        <div
          className="grid gap-3 pb-2"
          style={{
            gridTemplateColumns:
              'repeat(auto-fill, minmax(180px, 1fr))',
          }}
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
      )}
    </section>
  );
}

interface TileWrapperProps {
  tile: CommonGroundGameDto;
  disabled: boolean;
  atCap: boolean;
  isNominating: boolean;
  onNominate: (gameId: number) => void;
  onOpenDrawer: (gameId: number) => void;
  aiSuggested?: boolean;
  aiReasoning?: string;
}

export function CommonGroundTileWrapper(props: TileWrapperProps): JSX.Element {
  const {
    tile,
    disabled,
    atCap,
    isNominating,
    onNominate,
    onOpenDrawer,
    aiSuggested,
    aiReasoning,
  } = props;
  return (
    <div
      data-testid="common-ground-tile"
      className="flex flex-col gap-1 w-full max-w-[180px] mx-auto"
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open details for ${tile.gameName}`}
        onClick={() => onOpenDrawer(tile.gameId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDrawer(tile.gameId);
          }
        }}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 rounded-xl"
      >
        <CommonGroundGameCard
          game={tile}
          onNominate={(gameId: number) => {
            if (disabled || atCap || isNominating) return;
            onNominate(gameId);
          }}
          isNominating={isNominating}
          atCap={atCap || disabled}
          aiSuggested={aiSuggested}
          aiReasoning={aiReasoning}
          hideOverlay
        />
      </div>
      {tile.whyReason && (
        <div className="text-[10px] text-emerald-300 leading-snug px-1 line-clamp-2">
          ★ {tile.whyReason}
        </div>
      )}
      <button
        type="button"
        disabled={disabled || atCap || isNominating}
        aria-label={`Nominate ${tile.gameName}`}
        data-testid="common-ground-tile-nominate"
        onClick={(e) => {
          e.stopPropagation();
          if (disabled || atCap || isNominating) return;
          onNominate(tile.gameId);
        }}
        className="min-h-[44px] px-3 py-2 text-[12px] rounded bg-emerald-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        {isNominating ? 'Adding…' : atCap ? 'Lineup full' : '+ Nominate'}
      </button>
    </div>
  );
}
