/**
 * ROK-1830 PR-3 r2 — who owns an optimistic dismissal while it is in flight.
 *
 * Two prompts share ONE cache entry, and the same prompt can be dismissed
 * twice before either write answers, so neither "restore the snapshot" nor
 * "install the server's state" is safe on its own:
 *
 * - an older FAILED write must not remove a `(key, guildId)` a newer write
 *   already confirmed (Codex P2), and
 * - a success must not replace the whole entry, which would wipe a sibling
 *   pair's still-pending optimistic row (PR-3 review MINOR).
 *
 * So each pair carries a tiny ledger: how many writes are in flight, whether
 * any of them has been confirmed, and whether the pair was already dismissed
 * before the first one started. A rollback happens only for the LAST failing
 * write of a pair that nothing confirmed and that we ourselves added.
 */
import type { HubOnboardingKey, HubOnboardingStateDto } from '@raid-ledger/contract';
import type { HubOnboardingScope } from './hub-onboarding-api';

export interface PendingPair {
    /** Writes for this pair that have not settled yet. */
    inFlight: number;
    /** One of them came back with the server's state. */
    confirmed: boolean;
    /** The pair was dismissed before the first of those writes — nothing to undo. */
    preExisting: boolean;
}

/** Keyed by pair, not by viewer: the map lives in that viewer's query cache. */
export type PendingDismissals = Readonly<Record<string, PendingPair>>;

export function pairId(key: HubOnboardingKey, guildId: HubOnboardingScope): string {
    return `${key}:${guildId ?? 'global'}`;
}

/** Register one more in-flight write for `id`. */
export function beginPending(
    map: PendingDismissals, id: string, preExisting: boolean,
): PendingDismissals {
    const cur = map[id];
    const next: PendingPair = cur === undefined
        ? { inFlight: 1, confirmed: false, preExisting }
        : { ...cur, inFlight: cur.inFlight + 1 };
    return { ...map, [id]: next };
}

export interface SettleResult {
    map: PendingDismissals;
    /** The caller must remove this pair from the cache. */
    rollback: boolean;
}

/** Settle one write; the map drops the pair once nothing is in flight. */
export function settlePending(
    map: PendingDismissals, id: string, outcome: 'success' | 'error',
): SettleResult {
    const cur = map[id];
    if (cur === undefined) return { map, rollback: false };
    const inFlight = Math.max(0, cur.inFlight - 1);
    const confirmed = cur.confirmed || outcome === 'success';
    const rollback = outcome === 'error' && inFlight === 0 && !confirmed && !cur.preExisting;
    const rest = Object.fromEntries(Object.entries(map).filter(([k]) => k !== id));
    // A CONFIRMED pair outlives its own write. Another prompt's response can
    // already have been in flight when this one committed, so its body
    // predates the commit and omits this row; the entry is the only thing
    // that tells `mergePending` to keep it. `prunePending` drops it once the
    // server's own state reports the dismissal.
    const keep = inFlight > 0 || confirmed;
    return {
        map: keep ? { ...rest, [id]: { ...cur, inFlight, confirmed } } : rest,
        rollback,
    };
}

/**
 * The server's state, plus any optimistic row for a DIFFERENT pair that is
 * still in flight OR already confirmed — a sibling's dismissal must survive
 * this response even when the response's body predates its commit.
 */
export function mergePending(
    fresh: HubOnboardingStateDto,
    current: HubOnboardingStateDto | undefined,
    map: PendingDismissals,
): HubOnboardingStateDto {
    const known = new Set(fresh.dismissed.map((d) => pairId(d.key, d.guildId)));
    const kept = (current?.dismissed ?? []).filter((d) => {
        const pending = map[pairId(d.key, d.guildId)];
        if (pending === undefined || known.has(pairId(d.key, d.guildId))) return false;
        return pending.inFlight > 0 || pending.confirmed;
    });
    return kept.length === 0 ? fresh : { dismissed: [...fresh.dismissed, ...kept] };
}

/**
 * Forget settled pairs that a LATER response already accounts for — the
 * server state wins last. `self` (the pair whose own response this is) is
 * never pruned here: its body was read before its own commit landed in any
 * sibling's in-flight request, so only somebody else's response proves the
 * row is durable.
 */
export function prunePending(
    map: PendingDismissals, fresh: HubOnboardingStateDto, self: string,
): PendingDismissals {
    const known = new Set(fresh.dismissed.map((d) => pairId(d.key, d.guildId)));
    const entries = Object.entries(map).filter(
        ([id, pair]) => pair.inFlight > 0 || id === self || !known.has(id),
    );
    return entries.length === Object.keys(map).length ? map : Object.fromEntries(entries);
}

/** The three cache reads/writes the hook needs, bound to one pair. */
export interface PendingLedger {
    begin: (preExisting: boolean) => void;
    /** Settle one write; `true` = this caller must roll the entry back. */
    settle: (outcome: 'success' | 'error') => boolean;
    read: () => PendingDismissals;
    /** Drop confirmed pairs this server response already accounts for. */
    prune: (fresh: HubOnboardingStateDto) => void;
}

export function pendingLedger(
    read: () => PendingDismissals,
    write: (map: PendingDismissals) => void,
    id: string,
): PendingLedger {
    return {
        begin: (preExisting) => { write(beginPending(read(), id, preExisting)); },
        settle: (outcome) => {
            const { map, rollback } = settlePending(read(), id, outcome);
            write(map);
            return rollback;
        },
        read,
        prune: (fresh) => { write(prunePending(read(), fresh, id)); },
    };
}
