/**
 * ROK-1968 — ticks on the SAME checklist item go out one at a time. Two PATCHes
 * in flight together can reach the server out of order (check, then uncheck,
 * ends checked), so each item keeps a promise chain: a tick's request starts
 * only once the previous tick on that item has settled. Ticks on different
 * items still overlap. Module-level, so every card on the page shares it.
 */
const tails = new Map<string, Promise<unknown>>();
const waiting = new Map<string, number>();
const latest = new Map<string, number>();
let counter = 0;

const noop = (): void => undefined;

export function tickQueueKey(guildId: number, itemId: number): string {
    return `${guildId}:${itemId}`;
}

/** Ticks on `key` still waiting for an earlier one to settle (a test seam and a debugging aid). */
export function ticksWaiting(key: string): number {
    return waiting.get(key) ?? 0;
}

function bumpWaiting(key: string, by: 1 | -1): void {
    const next = ticksWaiting(key) + by;
    if (next > 0) waiting.set(key, next);
    else waiting.delete(key);
}

/** Runs `request` after every earlier tick on `key` has settled (resolved OR rejected). */
export function enqueueTick<T>(key: string, request: () => Promise<T>): Promise<T> {
    const prev = tails.get(key);
    let run: Promise<T>;
    if (prev === undefined) {
        run = request();
    } else {
        bumpWaiting(key, 1);
        run = prev.then(noop, noop).then(() => { bumpWaiting(key, -1); return request(); });
    }
    tails.set(key, run);
    const settle = (): void => { if (tails.get(key) === run) tails.delete(key); };
    run.then(settle, settle);
    return run;
}

/** Stamps a click on `key` as the newest; pair with `isLatestTick` so an older answer never overwrites a newer click. */
export function markTick(key: string): number {
    counter += 1;
    latest.set(key, counter);
    return counter;
}

export function isLatestTick(key: string, stamp: number): boolean {
    return latest.get(key) === stamp;
}
