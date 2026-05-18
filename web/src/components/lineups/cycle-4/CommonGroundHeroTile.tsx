/**
 * Single tile in the Cycle 4 Common Ground hero (ROK-1297). The tile body
 * acts as a U2 GameResearchDrawer trigger (role=button + aria-label).
 * Click bubbling on the per-tile `+ Nominate` button is stopped so it
 * fires the nominate handler without opening the drawer.
 */
import type { JSX } from 'react';
import type { CommonGroundGameDto } from '@raid-ledger/contract';

export interface CommonGroundHeroTileProps {
  game: CommonGroundGameDto;
  disabled: boolean;
  onNominate: () => void;
  onOpenDrawer: () => void;
}

const COVER_FALLBACK =
  'flex items-center justify-center bg-overlay/40 text-muted text-[10px] text-center px-2';
const NOMINATE_BTN_CLS =
  'inline-block px-2 py-0.5 text-[11px] rounded bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300';

function TileCover({ game }: { game: CommonGroundGameDto }): JSX.Element {
  if (game.coverUrl) {
    return (
      <img
        src={game.coverUrl}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
      />
    );
  }
  return <div className={`w-full h-full ${COVER_FALLBACK}`}>{game.gameName}</div>;
}

export function CommonGroundHeroTile(
  props: CommonGroundHeroTileProps,
): JSX.Element {
  const { game, disabled, onNominate, onOpenDrawer } = props;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${game.gameName}`}
      data-testid="common-ground-tile"
      onClick={onOpenDrawer}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenDrawer();
        }
      }}
      className="group flex flex-col gap-1 rounded-lg border border-edge bg-panel/40 overflow-hidden hover:border-emerald-500/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 cursor-pointer"
    >
      <div className="aspect-[3/2] w-full bg-zinc-900/40 overflow-hidden">
        <TileCover game={game} />
      </div>
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <div className="text-[12px] text-foreground truncate font-medium">
          {game.gameName}
        </div>
        {game.whyReason && (
          <div className="text-[10px] text-emerald-300 truncate">
            ★ {game.whyReason}
          </div>
        )}
        <div className="flex justify-end pt-1">
          <button
            type="button"
            disabled={disabled}
            aria-label={`Nominate ${game.gameName}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled) onNominate();
            }}
            className={NOMINATE_BTN_CLS}
          >
            + Nominate
          </button>
        </div>
      </div>
    </div>
  );
}
