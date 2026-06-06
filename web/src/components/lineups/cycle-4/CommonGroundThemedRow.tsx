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
import {
  nominateButtonState,
  VIEW_ONLY_LABEL,
} from '../nominate-button-state';

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
      <h3 className="text-base sm:text-lg font-semibold text-foreground">
        {meta.title}
      </h3>
      {tiles.length === 0 ? (
        <p className="text-[11px] text-muted py-2 px-1 italic">
          (no suggestions in this category yet)
        </p>
      ) : (
        <div
          className="grid gap-3 pb-2 [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))] md:[grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]"
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
  // ROK-1297 round 5ag-revised: keep the role=button on the INNER card
  // wrapper (avoids nested-interactive a11y warning from a <button> child
  // inside a role=button parent) and give the ★ reason line its own
  // mouse click handler so it isn't a dead tap area. The reason intentionally
  // has no role/tabIndex — keyboard users already reach the same drawer via
  // the inner card-button; a separate tab stop on the same target would be
  // noise.
  // ROK-1349: `disabled` carries the view-only (non-invitee) state; the
  // shared helper renders a "View only" label distinct from the cap copy.
  const btn = nominateButtonState(atCap, disabled, isNominating, {
    compact: true,
  });
  return (
    <div
      data-testid="common-ground-tile"
      className="flex flex-col gap-1 w-full"
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
          atCap={atCap}
          viewOnly={disabled}
          aiSuggested={aiSuggested}
          hideOverlay
          fluid
        />
      </div>
      <button
        type="button"
        disabled={btn.disabled}
        aria-label={`Nominate ${tile.gameName}`}
        title={disabled ? VIEW_ONLY_LABEL : undefined}
        data-testid="common-ground-tile-nominate"
        onClick={(e) => {
          e.stopPropagation();
          if (disabled || atCap || isNominating) return;
          onNominate(tile.gameId);
        }}
        // ROK-1297 round 5ac: button sits ABOVE the reason text so it's
        // adjacent to the cover (the action the user looked at last) and
        // the reason flows underneath as supporting context. Full-width
        // on every breakpoint; mobile keeps 44px tap target, desktop 32px.
        className="w-full min-h-[44px] sm:min-h-[32px] px-4 py-2 sm:py-1 text-sm rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 transition-colors"
      >
        {btn.label}
      </button>
      {(() => {
        // ROK-1297 round 5z: when this tile is AI-suggested, the badge's
        // old hover-tooltip carried the rich LLM reasoning while the line
        // below showed the generic whyReason — two sources conflicting.
        // Prefer aiReasoning (richer, contextual) when present; fall back
        // to whyReason.
        // Round 5ag (Codex P3): mouse click on the reason line opens the
        // same detail view as the cover. No role/tabIndex — keyboard users
        // already reach the drawer via the inner card-button above.
        const reasonText =
          aiSuggested && aiReasoning ? aiReasoning : tile.whyReason;
        if (!reasonText) return null;
        return (
          <div
            onClick={() => onOpenDrawer(tile.gameId)}
            className="text-xs text-emerald-300 leading-snug px-1 md:w-full cursor-pointer"
          >
            ★ {reasonText}
          </div>
        );
      })()}
    </div>
  );
}
