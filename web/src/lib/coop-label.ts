/**
 * The ONE source of co-op label copy (ROK-1401 round 3).
 *
 * The operator settled on exactly three labels, and every surface that shows
 * a co-op badge or pill uses this helper so the vocabulary can never drift
 * between them:
 *
 *   combo co-op   — `👥 5 combo co-op`   (or bare `👥 combo co-op`)
 *   online co-op  — `👥 5 online co-op`
 *   local co-op   — `👥 2 local co-op`
 *
 * `combo` is NOT derived from the two counts — it is Co-Optimus's own
 * metric under their own name: the `Combo Co-Op (Local + Online)` feature-list
 * flag, stored as `games.cooptimus_combo_coop`. Deriving it from
 * "has online AND has couch" would be our invention wearing their label, and
 * would disagree with them on games that publish both counts without the
 * combo feature.
 *
 * Priority is strict — combo > online > local — so a card shows exactly one
 * badge. The count leads the label: the ONLINE max where there is one (the
 * number that matters for a distributed group), else the couch max. A combo
 * game with neither count still gets its label; the flag is the claim, the
 * number is only detail.
 *
 * Thresholds are deliberately asymmetric:
 *   - online counts at `> 0` — Co-Optimus records 1 for a game whose online
 *     mode is co-op-adjacent, and that is still an online claim.
 *   - couch counts at `>= 2` — "1 couch player" is just single-player on a
 *     sofa, not local co-op, so it must not promote a game to `local`.
 *
 * Strictly Co-Optimus-verified: `0`, `null`, `undefined` and non-finite
 * values are all "no claim", and IGDB `playerCount` is NEVER consulted — a
 * lobby size is not a co-op capability (PUBG is not 100-player co-op). When
 * nothing qualifies this returns `null` and the caller renders NO element at
 * all: no placeholder, no reserved space.
 */

/** Which co-op mode the game is advertised as supporting. */
export type CoopKind = 'combo' | 'online' | 'local';

/** Raw Co-Optimus fields, exactly as they arrive on a DTO. */
export interface CoopCounts {
    /** `games.cooptimus_online_max`. */
    online: number | null | undefined;
    /** `games.cooptimus_couch_max`. */
    couch: number | null | undefined;
    /** `games.cooptimus_combo_coop` — their Local + Online feature flag. */
    combo?: boolean | null;
}

/** Resolved label: the count (when known), its kind, and the rendered copy. */
export interface CoopLabel {
    /** Online max, else couch max, else null for a combo game with neither. */
    count: number | null;
    kind: CoopKind;
    /** e.g. `👥 5 combo co-op` — count first, then the kind. */
    label: string;
}

/** A finite number at or above `floor`, else null. */
function atLeast(
    value: number | null | undefined,
    floor: number,
): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= floor
        ? value
        : null;
}

/**
 * Resolve the co-op label for a game, or `null` when it has no co-op claim.
 * See the module docstring for the rules — this is the only place they live.
 */
export function coopLabel({ online, couch, combo }: CoopCounts): CoopLabel | null {
    const onlineMax = atLeast(online, 1);
    const couchMax = atLeast(couch, 2);
    const count = onlineMax ?? couchMax;
    const kind: CoopKind | null =
        combo === true
            ? 'combo'
            : onlineMax != null
              ? 'online'
              : couchMax != null
                ? 'local'
                : null;
    if (kind == null) return null;
    return {
        count,
        kind,
        label: count == null ? `👥 ${kind} co-op` : `👥 ${count} ${kind} co-op`,
    };
}

/** Accessible name for a resolved label, shared by every surface. */
export function coopAriaLabel({ count, kind }: CoopLabel): string {
    return count == null
        ? `Co-op: ${kind}`
        : `Co-op: up to ${count} players ${kind}`;
}
