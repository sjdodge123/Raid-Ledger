/**
 * Single themed row (Owned / Taste / Trending) in the Common Ground hero
 * (ROK-1297). Renders up to 4 tiles in a responsive 4-column grid (2 on
 * small screens). The row is announced via `role="region"` with the theme
 * label so screen readers can navigate between the three buckets.
 */
import type { JSX } from 'react';
import type {
  CommonGroundGameDto,
  CommonGroundTheme,
} from '@raid-ledger/contract';
import { CommonGroundHeroTile } from './CommonGroundHeroTile';

export interface CommonGroundThemedRowProps {
  theme: CommonGroundTheme;
  tiles: CommonGroundGameDto[];
  atCap: boolean;
  canParticipate: boolean;
  nominatingId: number | null;
  onTileNominate: (gameId: number) => void;
  onTileOpenDrawer: (gameId: number) => void;
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <CommonGroundHeroTile
            key={tile.gameId}
            game={tile}
            disabled={
              atCap || !canParticipate || nominatingId === tile.gameId
            }
            onNominate={() => onTileNominate(tile.gameId)}
            onOpenDrawer={() => onTileOpenDrawer(tile.gameId)}
          />
        ))}
      </div>
    </section>
  );
}
