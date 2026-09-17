/**
 * Viewer-freshness hint for poll group availability (ROK-1560).
 *
 * The three-channel legend that lived here (fresh fill, stale fill, unknown
 * hatch) was retired with the painted heatmap in ROK-1588 — `GroupWeekLegend`
 * (desktop) and the phone module's legend carry the meaning now. The nudge for
 * a viewer whose own game time no longer counts is still shared by both.
 *
 * All colour comes from tokens / accent hues — no raw hex (15 themes).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';

const GAME_TIME_ROUTE = '/profile/gaming/game-time';

/** One-line nudge shown when the viewer's own game time no longer counts. */
export function ViewerStaleHint(): JSX.Element {
  return (
    <p data-testid="heatmap-stale-hint" className="text-xs text-amber-400">
      Your game time is stale —{' '}
      <Link to={GAME_TIME_ROUTE} className="underline underline-offset-2 hover:text-foreground">
        refresh it
      </Link>{' '}
      so the group sees when you are actually free.
    </p>
  );
}
