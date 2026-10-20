/**
 * A `now` epoch that advances every `intervalMs` while the caller is mounted
 * (ROK-1853): for "Scanned 3 min ago"-style labels that must keep ageing while
 * the page stays open. One interval per caller, cleared on unmount.
 *
 * `useNowTick` (`use-now-tick.ts`) is the countdown sibling — it ticks only
 * while a future instant is tracked, so it never ages a past timestamp.
 */
import { useEffect, useState } from 'react';

export function useNow(intervalMs = 60_000): number {
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [intervalMs]);
    return now;
}
