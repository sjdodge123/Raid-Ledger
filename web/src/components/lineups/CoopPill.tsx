/**
 * Co-op capability pill (ROK-1401) — shared by the three lineup pill rows:
 * `CommonGroundGameCard`, `AiSuggestionCard` and the `LineupBanner`
 * thumbnails. Copy is `👥 {n} co-op`, sized to match the violet players pill
 * it sits beside, in a distinct emerald/teal fill.
 *
 * **Strictly Co-Optimus-verified.** Only a finite positive
 * `cooptimus_online_max` renders anything: `0` means the sync ran and found
 * no online co-op, `null`/`undefined` means never synced (or a stale cached
 * row predating the field). All three render NOTHING — no element with the
 * `coop-pill` testid, no placeholder, no layout hole, so a pre-activation
 * surface is pixel-identical to before. IGDB `playerCount` is never a
 * fallback: a lobby size is not a co-op capability (PUBG is not 100-player
 * co-op).
 *
 * Carries no attribution credit — `/games/:id` is the credited surface
 * (ROK-1398/1399), the same division the game-card badge settled on.
 */
import type { JSX } from 'react';

export interface CoopPillProps {
    /** RAW `cooptimusOnlineMax` from the row / entry / suggestion DTO. */
    cooptimusOnlineMax: number | null | undefined;
    /** Extra positioning classes for the host pill row. */
    className?: string;
}

export function CoopPill({
    cooptimusOnlineMax,
    className = '',
}: CoopPillProps): JSX.Element | null {
    const count =
        typeof cooptimusOnlineMax === 'number' &&
        Number.isFinite(cooptimusOnlineMax) &&
        cooptimusOnlineMax > 0
            ? cooptimusOnlineMax
            : null;
    if (count == null) return null;
    return (
        <span
            data-testid="coop-pill"
            role="img"
            aria-label={`Co-op: up to ${count} players online`}
            className={`${className} px-1.5 py-0.5 text-[10px] font-bold rounded bg-teal-500/90 text-white whitespace-nowrap`}
        >
            {`👥 ${count} co-op`}
        </span>
    );
}
