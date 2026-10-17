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
    const { [id]: _dropped, ...rest } = map;
    return {
        map: inFlight === 0 ? rest : { ...rest, [id]: { ...cur, inFlight, confirmed } },
        rollback,
    };
}

/**
 * The server's state, plus any optimistic row for a DIFFERENT pair that is
 * still in flight — a sibling's dismissal must survive this response.
 */
export function mergePending(
    fresh: HubOnboardingStateDto,
    current: HubOnboardingStateDto | undefined,
    map: PendingDismissals,
): HubOnboardingStateDto {
    const known = new Set(fresh.dismissed.map((d) => pairId(d.key, d.guildId)));
    const kept = (current?.dismissed ?? []).filter((d) => {
        const id = pairId(d.key, d.guildId);
        return !known.has(id) && (map[id]?.inFlight ?? 0) > 0;
    });
    return kept.length === 0 ? fresh : { dismissed: [...fresh.dismissed, ...kept] };
}
