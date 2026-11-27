/**
 * ROK-2352 — `groupingSlots`: the active grouping's components paired with
 * the page context; `undefined` for every slot a grouping leaves out.
 */
import { describe, expect, it } from 'vitest';
import type { LfgGrouping, LfgGroupingContext } from '../../plugins/lfg-grouping';
import { groupingSlots } from './use-grouping-slots';

const CONTEXT: LfgGroupingContext = { gameId: 7, gameSlug: 'world-of-warcraft', groupKey: '', hubId: null };
const RaiseHand = () => null;
const LockIn = () => null;
const Badges = () => null;

describe('groupingSlots', () => {
    it('gives no slots without an active grouping (non-grouped game)', () => {
        expect(groupingSlots(null, CONTEXT)).toEqual({ raiseHand: undefined, lockInFields: undefined, memberBadges: undefined });
    });

    it('pairs each component the grouping provides with the page context', () => {
        const grouping: LfgGrouping = {
            id: 'g', gameSlugs: [CONTEXT.gameSlug],
            RaiseHandFields: RaiseHand, LockInFields: LockIn, MemberBadges: Badges,
        };
        const slots = groupingSlots(grouping, CONTEXT);
        expect(slots.raiseHand).toEqual({ Fields: RaiseHand, context: CONTEXT });
        expect(slots.lockInFields).toEqual({ Fields: LockIn, context: CONTEXT });
        expect(slots.memberBadges).toEqual({ Badges, context: CONTEXT });
    });

    it('leaves out the slots a grouping does not provide', () => {
        const slots = groupingSlots({ id: 'g', gameSlugs: [], MemberBadges: Badges }, CONTEXT);
        expect(slots.raiseHand).toBeUndefined();
        expect(slots.lockInFields).toBeUndefined();
        expect(slots.memberBadges).toEqual({ Badges, context: CONTEXT });
    });
});
