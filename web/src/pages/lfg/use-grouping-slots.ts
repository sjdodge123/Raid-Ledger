/**
 * ROK-2352 — the active `lfg-grouping` plugin's components, each paired with
 * the page context, in the slot shape the page's children take. A slot is
 * `undefined` when no grouping is active or the grouping leaves it out, so
 * every non-grouped game renders exactly today's page.
 */
import { useMemo } from 'react';
import type { LfgGrouping, LfgGroupingContext } from '../../plugins/lfg-grouping';
import type { LfgRaiseHandSlot } from './LfgJoinControl';
import type { LfgLockInSlot } from './lfg-group-overlays';
import type { LfgMemberBadgesSlot } from './LfgParticipantsList';

export interface LfgGroupingSlots {
    raiseHand: LfgRaiseHandSlot | undefined;
    lockInFields: LfgLockInSlot | undefined;
    memberBadges: LfgMemberBadgesSlot | undefined;
}

/** Pure form of {@link useGroupingSlots}. */
export function groupingSlots(grouping: LfgGrouping | null, context: LfgGroupingContext): LfgGroupingSlots {
    const RaiseHand = grouping?.RaiseHandFields;
    const LockIn = grouping?.LockInFields;
    const Badges = grouping?.MemberBadges;
    return {
        raiseHand: RaiseHand ? { Fields: RaiseHand, context } : undefined,
        lockInFields: LockIn ? { Fields: LockIn, context } : undefined,
        memberBadges: Badges ? { Badges, context } : undefined,
    };
}

/** The grouping's raise-hand, lock-in and member-badge slots for the page. */
export function useGroupingSlots(grouping: LfgGrouping | null, context: LfgGroupingContext): LfgGroupingSlots {
    return useMemo(() => groupingSlots(grouping, context), [grouping, context]);
}
