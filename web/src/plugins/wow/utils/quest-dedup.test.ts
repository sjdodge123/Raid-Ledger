import { describe, it, expect } from 'vitest';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';
import { isQuestUsable, pickBestVariant, deduplicateByName } from './quest-dedup';

/** Minimal quest factory — overrides only what each test needs */
function makeQuest(overrides: Partial<EnrichedDungeonQuestDto> = {}): EnrichedDungeonQuestDto {
    return {
        questId: 1,
        dungeonInstanceId: 100,
        name: 'Test Quest',
        questLevel: 60,
        requiredLevel: 55,
        expansion: 'classic',
        questGiverNpc: null,
        questGiverZone: null,
        prevQuestId: null,
        nextQuestId: null,
        rewardsJson: null,
        objectives: null,
        classRestriction: null,
        raceRestriction: null,
        startsInsideDungeon: false,
        sharable: true,
        rewardXp: null,
        rewardGold: null,
        rewardType: null,
        rewards: null,
        prerequisiteChain: null,
        ...overrides,
    };
}

describe('isQuestUsable', () => {
    it('returns true when quest has no restrictions', () => {
        const quest = makeQuest();
        expect(isQuestUsable(quest, 'Warrior', 'Orc')).toBe(true);
    });

    it('returns true when character race matches restriction', () => {
        const quest = makeQuest({ raceRestriction: ['Orc', 'Troll'] });
        expect(isQuestUsable(quest, 'Warrior', 'Orc')).toBe(true);
    });

    it('returns false when character race does not match restriction', () => {
        const quest = makeQuest({ raceRestriction: ['Orc', 'Troll'] });
        expect(isQuestUsable(quest, 'Warrior', 'Human')).toBe(false);
    });

    it('returns true when character class matches restriction', () => {
        const quest = makeQuest({ classRestriction: ['Warrior', 'Paladin'] });
        expect(isQuestUsable(quest, 'Warrior', 'Human')).toBe(true);
    });

    it('returns false when character class does not match restriction', () => {
        const quest = makeQuest({ classRestriction: ['Warrior', 'Paladin'] });
        expect(isQuestUsable(quest, 'Mage', 'Human')).toBe(false);
    });

    it('returns true when both race and class match restrictions', () => {
        const quest = makeQuest({
            raceRestriction: ['Orc'],
            classRestriction: ['Warrior'],
        });
        expect(isQuestUsable(quest, 'Warrior', 'Orc')).toBe(true);
    });

    it('returns false when race matches but class does not', () => {
        const quest = makeQuest({
            raceRestriction: ['Orc'],
            classRestriction: ['Paladin'],
        });
        expect(isQuestUsable(quest, 'Warrior', 'Orc')).toBe(false);
    });

    it('returns false when class matches but race does not', () => {
        const quest = makeQuest({
            raceRestriction: ['Human'],
            classRestriction: ['Warrior'],
        });
        expect(isQuestUsable(quest, 'Warrior', 'Orc')).toBe(false);
    });

    it('treats null charClass as matching any class restriction', () => {
        const quest = makeQuest({ classRestriction: ['Warrior'] });
        expect(isQuestUsable(quest, null, 'Human')).toBe(true);
    });

    it('treats null charRace as matching any race restriction', () => {
        const quest = makeQuest({ raceRestriction: ['Orc'] });
        expect(isQuestUsable(quest, 'Warrior', null)).toBe(true);
    });

    it('treats both null charClass and charRace as matching all restrictions', () => {
        const quest = makeQuest({
            classRestriction: ['Warrior'],
            raceRestriction: ['Orc'],
        });
        expect(isQuestUsable(quest, null, null)).toBe(true);
    });

    it('matches case-insensitively', () => {
        const quest = makeQuest({
            classRestriction: ['WARRIOR'],
            raceRestriction: ['orc'],
        });
        expect(isQuestUsable(quest, 'warrior', 'ORC')).toBe(true);
    });

    it('treats empty restriction arrays as unrestricted', () => {
        const quest = makeQuest({
            classRestriction: [],
            raceRestriction: [],
        });
        expect(isQuestUsable(quest, 'Warrior', 'Human')).toBe(true);
    });
});

describe('pickBestVariant', () => {
    const unrestricted = makeQuest({ questId: 1 });
    const raceOnly = makeQuest({ questId: 2, raceRestriction: ['Orc'] });
    const classOnly = makeQuest({ questId: 3, classRestriction: ['Warrior'] });
    const raceAndClass = makeQuest({
        questId: 4,
        raceRestriction: ['Orc'],
        classRestriction: ['Warrior'],
    });

    it('picks first compatible variant (restricted match found first)', () => {
        // Restricted variants before unrestricted — restricted match wins
        const result = pickBestVariant(
            [raceAndClass, unrestricted],
            'Warrior', 'Orc',
        );
        expect(result.questId).toBe(4);
    });

    it('picks unrestricted when it appears before restricted matches', () => {
        // Unrestricted is also "compatible" — .find() returns it first
        const result = pickBestVariant(
            [unrestricted, raceAndClass],
            'Warrior', 'Orc',
        );
        expect(result.questId).toBe(1);
    });

    it('picks race-only match over non-matching restriction', () => {
        const nonMatch = makeQuest({ questId: 5, raceRestriction: ['Human'] });
        const result = pickBestVariant(
            [nonMatch, raceOnly],
            'Mage', 'Orc',
        );
        expect(result.questId).toBe(2);
    });

    it('picks class-only match over non-matching restriction', () => {
        const nonMatch = makeQuest({ questId: 5, raceRestriction: ['Troll'] });
        const result = pickBestVariant(
            [nonMatch, classOnly],
            'Warrior', 'Gnome',
        );
        expect(result.questId).toBe(3);
    });

    it('falls back to unrestricted when no restriction matches', () => {
        const result = pickBestVariant(
            [raceOnly, unrestricted, classOnly],
            'Mage', 'Gnome',
        );
        expect(result.questId).toBe(1);
    });

    it('falls back to first variant when nothing matches and no unrestricted', () => {
        const hordeQuest = makeQuest({ questId: 10, raceRestriction: ['Orc'] });
        const allianceQuest = makeQuest({ questId: 11, raceRestriction: ['Human'] });
        const result = pickBestVariant(
            [hordeQuest, allianceQuest],
            'Mage', 'Gnome',
        );
        expect(result.questId).toBe(10);
    });

    it('falls back to unrestricted when charRace and charClass are both null', () => {
        const result = pickBestVariant(
            [raceOnly, unrestricted, classOnly],
            null, null,
        );
        expect(result.questId).toBe(1);
    });

    it('matches case-insensitively against restrictions', () => {
        const uppercaseRestriction = makeQuest({
            questId: 20,
            raceRestriction: ['ORC'],
            classRestriction: ['WARRIOR'],
        });
        // Restricted variant first so it's found before unrestricted
        const result = pickBestVariant(
            [uppercaseRestriction, unrestricted],
            'warrior', 'orc',
        );
        expect(result.questId).toBe(20);
    });

    it('returns the only variant when given a single-element array', () => {
        const result = pickBestVariant([raceOnly], 'Mage', 'Gnome');
        expect(result.questId).toBe(2);
    });
});

describe('deduplicateByName', () => {
    it('returns empty array for empty input', () => {
        expect(deduplicateByName([], null, null)).toEqual([]);
    });

    it('returns single quest unchanged', () => {
        const quest = makeQuest({ questId: 1, name: 'Solo Quest' });
        const result = deduplicateByName([quest], 'Warrior', 'Orc');
        expect(result).toHaveLength(1);
        expect(result[0].questId).toBe(1);
    });

    it('keeps quests with different names', () => {
        const q1 = makeQuest({ questId: 1, name: 'Quest A', dungeonInstanceId: 100 });
        const q2 = makeQuest({ questId: 2, name: 'Quest B', dungeonInstanceId: 100 });
        const result = deduplicateByName([q1, q2], null, null);
        expect(result).toHaveLength(2);
    });

    it('deduplicates quests with the same name and dungeon', () => {
        const horde = makeQuest({
            questId: 1, name: 'Shared Quest', dungeonInstanceId: 100,
            raceRestriction: ['Orc'],
        });
        const alliance = makeQuest({
            questId: 2, name: 'Shared Quest', dungeonInstanceId: 100,
            raceRestriction: ['Human'],
        });
        const result = deduplicateByName([horde, alliance], 'Warrior', 'Orc');
        expect(result).toHaveLength(1);
        expect(result[0].questId).toBe(1);
    });

    it('keeps same-name quests from different dungeons separate', () => {
        const q1 = makeQuest({ questId: 1, name: 'Shared Quest', dungeonInstanceId: 100 });
        const q2 = makeQuest({ questId: 2, name: 'Shared Quest', dungeonInstanceId: 200 });
        const result = deduplicateByName([q1, q2], null, null);
        expect(result).toHaveLength(2);
    });

    it('picks best variant per group when all quests share the same name', () => {
        const orcVersion = makeQuest({
            questId: 1, name: 'Faction Quest', dungeonInstanceId: 100,
            raceRestriction: ['Orc'],
        });
        const humanVersion = makeQuest({
            questId: 2, name: 'Faction Quest', dungeonInstanceId: 100,
            raceRestriction: ['Human'],
        });
        const trollVersion = makeQuest({
            questId: 3, name: 'Faction Quest', dungeonInstanceId: 100,
            raceRestriction: ['Troll'],
        });
        const result = deduplicateByName(
            [orcVersion, humanVersion, trollVersion],
            'Warrior', 'Orc',
        );
        expect(result).toHaveLength(1);
        expect(result[0].questId).toBe(1);
    });

    it('handles no race/class info on character by picking unrestricted', () => {
        const restricted = makeQuest({
            questId: 1, name: 'Faction Quest', dungeonInstanceId: 100,
            raceRestriction: ['Orc'],
        });
        const unrestricted = makeQuest({
            questId: 2, name: 'Faction Quest', dungeonInstanceId: 100,
        });
        const result = deduplicateByName([restricted, unrestricted], null, null);
        expect(result).toHaveLength(1);
        expect(result[0].questId).toBe(2);
    });

    it('handles multiple groups with deduplication in each', () => {
        const q1a = makeQuest({
            questId: 1, name: 'Quest A', dungeonInstanceId: 100,
            raceRestriction: ['Orc'],
        });
        const q1b = makeQuest({
            questId: 2, name: 'Quest A', dungeonInstanceId: 100,
            raceRestriction: ['Human'],
        });
        const q2a = makeQuest({
            questId: 3, name: 'Quest B', dungeonInstanceId: 100,
            raceRestriction: ['Orc'],
        });
        const q2b = makeQuest({
            questId: 4, name: 'Quest B', dungeonInstanceId: 100,
            raceRestriction: ['Human'],
        });
        const result = deduplicateByName([q1a, q1b, q2a, q2b], 'Warrior', 'Orc');
        expect(result).toHaveLength(2);
        expect(result.map(q => q.questId).sort()).toEqual([1, 3]);
    });
});
