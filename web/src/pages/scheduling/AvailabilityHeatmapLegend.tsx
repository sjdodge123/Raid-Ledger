/**
 * Legend + viewer-freshness hint for the poll availability heatmap (ROK-1560).
 *
 * The grid paints two independent channels: the fill is *fresh* availability and
 * the diagonal hatch is *stale or unknown* members. Nothing on the grid explains
 * that on its own, so this names both and nudges a viewer whose own game time is
 * too old to be counted in the fill.
 *
 * All colour comes from `--color-*` tokens / accent hues — no raw hex (15 themes).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { computeHeatmapBg, computeHeatmapHatch } from '../../components/features/game-time/grid-cell.utils';

const GAME_TIME_ROUTE = '/profile/gaming/game-time';

/**
 * Swatches are produced by the same helpers the grid paints with, so the legend
 * cannot drift from the cells — and so this file introduces no colour of its own
 * (`computeHeatmapBg`'s hardcoded rgba predates ROK-1560; the hatch is tokenised).
 */
const FILL_SWATCH = computeHeatmapBg({ available: 1, total: 1 });
const HATCH_SWATCH = computeHeatmapHatch({ available: 0, total: 1, stale: 1, unknown: 0 });

/** One legend row: a swatch plus the channel it stands for. */
function LegendKey({ style, label }: { style: React.CSSProperties; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-3 w-3 rounded-sm border border-edge" style={style} />
      <span>{label}</span>
    </span>
  );
}

/** Two-channel legend for the availability heatmap. */
export function AvailabilityHeatmapLegend({ freshnessDays }: { freshnessDays: number }): JSX.Element {
  return (
    <div data-testid="heatmap-legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <LegendKey
        style={{ backgroundColor: FILL_SWATCH }}
        label={`free (confirmed in the last ${freshnessDays} days)`}
      />
      <LegendKey
        style={{ backgroundImage: HATCH_SWATCH, backgroundColor: 'var(--color-panel)' }}
        label="stale or unknown"
      />
    </div>
  );
}

/** One-line nudge shown when the viewer's own game time no longer counts. */
export function ViewerStaleHint(): JSX.Element {
  return (
    <p data-testid="heatmap-stale-hint" className="text-xs text-amber-400">
      Your game time is stale —{' '}
      <Link to={GAME_TIME_ROUTE} className="underline underline-offset-2 hover:text-amber-300">
        refresh it
      </Link>{' '}
      so the group sees when you are actually free.
    </p>
  );
}
