/**
 * ROK-2169: the counts behind the Quest Prep to-do lines.
 */
import { describe, it, expect } from 'vitest';
import type { EnrichedDungeonQuestDto, EventQuestPrereqsResponse, QuestCoverageEntry } from '@raid-ledger/contract';
import { countSharableToGrab, summariseQuestPrep, viewerChainProgress } from './quest-prep-todo';

function quest(overrides: Partial<EnrichedDungeonQuestDto>): EnrichedDungeonQuestDto {
    return {
        questId: 1, dungeonInstanceId: 1, name: 'Quest', questLevel: 25, requiredLevel: 20,
        expansion: 'classic', questGiverNpc: null, questGiverZone: null, prevQuestId: null,
        nextQuestId: null, rewardsJson: null, objectives: null, classRestriction: null,
        raceRestriction: null, startsInsideDungeon: false, sharable: true, rewardXp: null,
        rewardGold: null, rewardType: null, rewards: [], prerequisiteChain: null,
        ...overrides,
    };
}

function chainQuest(questId: number, prevId: number, overrides: Partial<EnrichedDungeonQuestDto> = {}) {
    return quest({
        questId, prevQuestId: prevId, sharable: false,
        prerequisiteChain: [quest({ questId: prevId }), quest({ questId })],
        ...overrides,
    });
}

function coverage(entries: Array<[number, number[]]>): Map<number, QuestCoverageEntry> {
    return new Map(entries.map(([questId, users]) => [questId, {
        questId, coveredBy: users.map((userId) => ({ userId, username: `u${userId}` })),
    }]));
}

function prereqs(overrides: Partial<NonNullable<EventQuestPrereqsResponse>> = {}): NonNullable<EventQuestPrereqsResponse> {
    return {
        characterId: '11111111-1111-4111-8111-111111111111',
        asOf: '2026-10-01T12:00:00.000Z',
        quests: [],
        neededTotal: 0,
        ...overrides,
    };
}

const step = (questId: number, done: boolean) => ({ questId, name: `Step ${questId}`, done, source: 'addon' as const });

describe('countSharableToGrab', () => {
    const quests = [
        quest({ questId: 1 }), quest({ questId: 2 }), quest({ questId: 3 }),
        quest({ questId: 4, startsInsideDungeon: true }),
        chainQuest(5, 50, { sharable: true }),
        quest({ questId: 6, sharable: false }),
    ];

    it('counts only sharable, non-chain quests to get before going in that nobody picked up', () => {
        // 1 covered by the viewer, 2 covered by someone else, 3 uncovered.
        expect(countSharableToGrab(quests, coverage([[1, [7]], [2, [8]]]))).toBe(1);
    });

    it('counts a quest with an empty coveredBy list as uncovered', () => {
        expect(countSharableToGrab(quests, coverage([[1, []], [2, [8]]]))).toBe(2);
    });

    it('excludes quests picked up inside, chain quests and solo quests', () => {
        expect(countSharableToGrab(quests, new Map())).toBe(3);
    });
});

describe('viewerChainProgress', () => {
    const chains = [chainQuest(20, 10), chainQuest(40, 30)];

    it('is unknown without a pre-req state or without an addon snapshot', () => {
        expect(viewerChainProgress(chains, undefined)).toEqual({ status: 'unknown' });
        expect(viewerChainProgress(chains, null)).toEqual({ status: 'unknown' });
        expect(viewerChainProgress(chains, prereqs({ asOf: null, neededTotal: 3 }))).toEqual({ status: 'unknown' });
    });

    it('reports the server count of missing steps', () => {
        const state = prereqs({ neededTotal: 2, quests: [
            { questId: 20, steps: [step(10, false)], neededCount: 1, completed: false, completedSource: null },
        ] });
        expect(viewerChainProgress(chains, state)).toEqual({ status: 'missing', steps: 2 });
    });

    it('is done when every chain step is known and done', () => {
        const state = prereqs({ quests: [
            { questId: 20, steps: [step(10, true)], neededCount: 0, completed: false, completedSource: null },
            { questId: 40, steps: [step(30, true)], neededCount: 0, completed: false, completedSource: null },
        ] });
        expect(viewerChainProgress(chains, state)).toEqual({ status: 'done' });
    });

    it('is unknown, never done, when a step was dropped as unknown (ROK-1758)', () => {
        const state = prereqs({ quests: [
            { questId: 20, steps: [step(10, true)], neededCount: 0, completed: false, completedSource: null },
            { questId: 40, steps: [], neededCount: 0, completed: false, completedSource: null },
        ] });
        expect(viewerChainProgress(chains, state)).toEqual({ status: 'unknown' });
    });

    it('is unknown when a chain quest has no state at all', () => {
        const state = prereqs({ quests: [
            { questId: 20, steps: [step(10, true)], neededCount: 0, completed: false, completedSource: null },
        ] });
        expect(viewerChainProgress(chains, state)).toEqual({ status: 'unknown' });
    });
});

describe('summariseQuestPrep', () => {
    it('counts chain quests in both location groups', () => {
        const quests = [quest({ questId: 1 }), chainQuest(20, 10), chainQuest(40, 30, { startsInsideDungeon: true })];
        expect(summariseQuestPrep(quests, new Map(), undefined)).toEqual({
            sharableToGrab: 1, chains: 2, viewer: { status: 'unknown' },
        });
    });

    it('is all zero when every sharable is covered and there are no chains', () => {
        expect(summariseQuestPrep([quest({ questId: 1 })], coverage([[1, [9]]]), prereqs()))
            .toEqual({ sharableToGrab: 0, chains: 0, viewer: { status: 'done' } });
    });
});
