/**
 * ROK-1479 D11 — one countdown clock per mounted list, never one per row.
 *
 * Every surface that prints "24 min left" needs a `now` that moves, and the
 * naive shape is a `setInterval` inside each row. On a roster that is N timers
 * and N independent re-renders per second. This hook holds ONE interval and
 * one `now`, and each row formats `expiresAt − now` from it — so an N-member
 * strip costs one timer and one re-render per tick.
 *
 * Two behaviours are load-bearing rather than cosmetic:
 *   • **No interval at all when nothing is tracked.** The group page mounts
 *     this on every group, and most groups have no `now` members; a timer that
 *     wakes every 15 s to recompute nothing is pure background cost.
 *   • **The cadence follows the soonest instant.** 15 s is invisible at minute
 *     granularity, but the last two minutes render in SECONDS, so the tick
 *     tightens to 5 s exactly while that is true.
 *
 * The returned value is a millisecond epoch, not a `Date`, so a consumer can
 * use it as a `useMemo`/effect dependency without an identity change per tick.
 */
import { useEffect, useState } from 'react';

/** Cadence while the soonest tracked instant is comfortably away. */
export const NOW_TICK_SLOW_MS = 15_000;
/** Cadence inside the seconds-granularity window. */
export const NOW_TICK_FAST_MS = 5_000;
/** How close the soonest instant must be to earn the fast cadence. */
export const NOW_TICK_FAST_WINDOW_MS = 120_000;

/**
 * The earliest parseable instant in the list, as a millisecond epoch.
 *
 * Returns `null` for an empty list AND for a list of unparseable strings —
 * both mean "there is nothing to count down to", which is what suppresses the
 * interval entirely.
 *
 * @param instants - ISO-8601 strings; unparseable entries are ignored.
 */
function soonestOf(instants: readonly string[]): number | null {
    let soonest: number | null = null;
    for (const iso of instants) {
        const at = Date.parse(iso);
        if (Number.isNaN(at)) continue;
        if (soonest === null || at < soonest) soonest = at;
    }
    return soonest;
}

/**
 * A `now` epoch that advances on a shared interval while `instants` is
 * non-empty, and a static `Date.now()` when it is not.
 *
 * @param instants - The expiry instants the caller renders a countdown for.
 * @returns Milliseconds since the epoch; re-rendered on each tick.
 */
export function useNowTick(instants: readonly string[]): number {
    const [now, setNow] = useState<number>(() => Date.now());

    // Both are primitives, so the effect below re-subscribes only when the
    // tracked horizon or the cadence genuinely changes — not on every render.
    const soonest = soonestOf(instants);
    const cadence =
        soonest !== null && soonest - now <= NOW_TICK_FAST_WINDOW_MS
            ? NOW_TICK_FAST_MS
            : NOW_TICK_SLOW_MS;

    useEffect(() => {
        if (soonest === null) return;
        const timer = setInterval(() => setNow(Date.now()), cadence);
        return () => clearInterval(timer);
    }, [soonest, cadence]);

    return now;
}
