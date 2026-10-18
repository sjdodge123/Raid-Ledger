/**
 * ROK-1830 PR-3 r4 — one rule decides whether an optimistic dismissal lives.
 *
 * Two prompts share ONE cache entry and their writes answer out of order, so
 * a response body is never proof that a row is absent: it only knows the rows
 * the server held when it was READ. Earlier rounds expired a confirmed entry
 * as soon as some later body carried it — and a third, slower response could
 * still arrive with a body older than that one, un-dismissing the pair
 * (Codex P2 r4: A confirms, B's body carries A and drops its entry, C's
 * delayed `[C]` then wins).
 *
 * So the ledger stops guessing. A dismissal this session has CONFIRMED is
 * removed only by an explicitly confirmed restore (`DELETE … success`), never
 * by a GET or POST body:
 *
 *     merge(server, ledger) = server ∪ confirmed ∪ in-flight − restoring
 *
 * Confirmed entries therefore live as long as the QueryClient. That is
 * bounded and tiny — at most (prompt keys) × (guilds the viewer can see).
 */
import type { HubOnboardingKey, HubOnboardingStateDto } from '@raid-ledger/contract';
import type { HubOnboardingScope } from './hub-onboarding-api';

export interface PendingPair {
    /** Dismiss writes for this pair that have not settled yet. */
    inFlight: number;
    /** One of them came back with the server's state. */
    confirmed: boolean;
    /** The pair was dismissed before the first of those writes — nothing to undo. */
    preExisting: boolean;
    /** Restore (`DELETE`) writes in flight; the row hides while any is. */
    restoring: number;
}

/** Keyed by pair, not by viewer: the map lives in that viewer's query cache. */
export type PendingDismissals = Readonly<Record<string, PendingPair>>;

const EMPTY: PendingPair = { inFlight: 0, confirmed: false, preExisting: false, restoring: 0 };

export function pairId(key: HubOnboardingKey, guildId: HubOnboardingScope): string {
    return `${key}:${guildId ?? 'global'}`;
}

/** Store `pair`, or forget the id entirely once it says nothing. */
function put(map: PendingDismissals, id: string, pair: PendingPair): PendingDismissals {
    if (pair.inFlight === 0 && pair.restoring === 0 && !pair.confirmed) {
        return Object.fromEntries(Object.entries(map).filter(([k]) => k !== id));
    }
    return { ...map, [id]: pair };
}

/** Register one more in-flight dismiss for `id`. */
export function beginPending(
    map: PendingDismissals, id: string, preExisting: boolean,
): PendingDismissals {
    const cur = map[id];
    return put(map, id, cur === undefined
        ? { ...EMPTY, inFlight: 1, preExisting }
        : { ...cur, inFlight: cur.inFlight + 1 });
}

export interface SettleResult {
    map: PendingDismissals;
    /** The caller must put the cache row back the way it was. */
    rollback: boolean;
}

/**
 * Settle one dismiss write. A confirmed pair stays in the map for good — only
 * `settleRestore('success')` clears it.
 */
export function settlePending(
    map: PendingDismissals, id: string, outcome: 'success' | 'error',
): SettleResult {
    const cur = map[id];
    if (cur === undefined) return { map, rollback: false };
    const inFlight = Math.max(0, cur.inFlight - 1);
    const confirmed = cur.confirmed || outcome === 'success';
    // Only the LAST failing write of a pair nothing confirmed, and only when
    // we were the ones who added the row, may take it off the screen again.
    const rollback = outcome === 'error' && inFlight === 0 && !confirmed && !cur.preExisting;
    return { map: put(map, id, { ...cur, inFlight, confirmed }), rollback };
}

/** Register one more in-flight restore; the row disappears optimistically. */
export function beginRestore(map: PendingDismissals, id: string): PendingDismissals {
    const cur = map[id] ?? EMPTY;
    return put(map, id, { ...cur, restoring: cur.restoring + 1 });
}

/**
 * Settle one restore. Success is the ONLY thing that clears a confirmed
 * dismissal; a failure rolls the row back onto the screen and leaves the
 * confirmation standing.
 */
export function settleRestore(
    map: PendingDismissals, id: string, outcome: 'success' | 'error',
): SettleResult {
    const cur = map[id];
    if (cur === undefined) return { map, rollback: false };
    const restoring = Math.max(0, cur.restoring - 1);
    const cleared = outcome === 'success';
    const next: PendingPair = {
        ...cur,
        restoring,
        confirmed: cleared ? false : cur.confirmed,
        preExisting: cleared ? false : cur.preExisting,
    };
    return { map: put(map, id, next), rollback: outcome === 'error' && restoring === 0 };
}

/**
 * The server's state, plus every optimistic row this session still owns — one
 * that is in flight or already confirmed — minus any pair whose restore is in
 * flight. A sibling's dismissal survives a response whose body predates its
 * commit, because nothing but a confirmed restore retires it.
 */
export function mergePending(
    fresh: HubOnboardingStateDto,
    current: HubOnboardingStateDto | undefined,
    map: PendingDismissals,
): HubOnboardingStateDto {
    const restoring = (id: string): boolean => (map[id]?.restoring ?? 0) > 0;
    const server = fresh.dismissed.filter((d) => !restoring(pairId(d.key, d.guildId)));
    const known = new Set(server.map((d) => pairId(d.key, d.guildId)));
    const kept = (current?.dismissed ?? []).filter((d) => {
        const id = pairId(d.key, d.guildId);
        const pending = map[id];
        if (pending === undefined || known.has(id) || pending.restoring > 0) return false;
        return pending.inFlight > 0 || pending.confirmed;
    });
    if (kept.length === 0 && server.length === fresh.dismissed.length) return fresh;
    return { dismissed: [...server, ...kept] };
}

/** The cache reads/writes the hook needs, bound to one pair. */
export interface PendingLedger {
    begin: (preExisting: boolean) => void;
    /** Settle one dismiss; `true` = this caller must roll the entry back. */
    settle: (outcome: 'success' | 'error') => boolean;
    beginRestore: () => void;
    /** Settle one restore; `true` = this caller must put the row back. */
    settleRestore: (outcome: 'success' | 'error') => boolean;
    read: () => PendingDismissals;
}

export function pendingLedger(
    read: () => PendingDismissals,
    write: (map: PendingDismissals) => void,
    id: string,
): PendingLedger {
    const settleWith = (
        settle: (map: PendingDismissals, id: string, outcome: 'success' | 'error') => SettleResult,
        outcome: 'success' | 'error',
    ): boolean => {
        const result = settle(read(), id, outcome);
        write(result.map);
        return result.rollback;
    };
    return {
        begin: (preExisting) => { write(beginPending(read(), id, preExisting)); },
        settle: (outcome) => settleWith(settlePending, outcome),
        beginRestore: () => { write(beginRestore(read(), id)); },
        settleRestore: (outcome) => settleWith(settleRestore, outcome),
        read,
    };
}
