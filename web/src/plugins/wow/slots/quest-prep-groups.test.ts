/** ROK-2216 U1 — the event page's quest grouping, shared with the hub Dungeon planner. */
import { describe, it, expect } from 'vitest';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import { groupByType, splitByLocation } from './quest-prep-groups';

/** Same factory as `quest-prep-panel.test.tsx`. */
function createQuest(overrides: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId: 100, dungeonInstanceId: 1, name: 'Test Quest', questLevel: 25, requiredLevel: 20,
        expansion: 'classic', questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null,
        rewardsJson: null, objectives: null, classRestriction: null, raceRestriction: null,
        startsInsideDungeon: false, sharable: true, rewardXp: null, rewardGold: null, rewardType: null,
        rewards: [], prerequisiteChain: null, ...overrides,
    };
}

const SHARABLE = createQuest({ questId: 201, sharable: true });
const CHAIN_SHARABLE = createQuest({ questId: 202, sharable: true, prevQuestId: 150 });
const CHAIN_SOLO = createQuest({ questId: 203, sharable: false, prevQuestId: 151, startsInsideDungeon: true });
const SOLO = createQuest({ questId: 204, sharable: false });
const SOLO_INSIDE = createQuest({ questId: 205, sharable: false, startsInsideDungeon: true });
const ALL = [SHARABLE, CHAIN_SHARABLE, CHAIN_SOLO, SOLO, SOLO_INSIDE];

const ids = (list: EnrichedDungeonQuestDto[]): number[] => list.map((q) => q.questId);

describe('groupByType', () => {
    it('buckets Sharable / Requires quest chain / Must pick up yourself like the Quest Prep panel', () => {
        const groups = groupByType(ALL);
        expect(ids(groups.sharable)).toEqual([201]);
        expect(ids(groups.chain)).toEqual([202, 203]);
        expect(ids(groups.solo)).toEqual([204, 205]);
    });

    it('returns three empty buckets for no quests', () => {
        expect(groupByType([])).toEqual({ sharable: [], chain: [], solo: [] });
    });
});

describe('splitByLocation', () => {
    it('splits "Get before you go in" from "Picked up inside", keeping order', () => {
        const { before, inside } = splitByLocation(ALL);
        expect(ids(before)).toEqual([201, 202, 204]);
        expect(ids(inside)).toEqual([203, 205]);
    });
});
