import { describe, it, expect } from 'vitest';
import { characterSide, factionOfRace, isQuestUsableBySide } from './quest-faction';
import { isQuestUsable } from './quest-dedup';
import type { EnrichedDungeonQuestDto } from '@raid-ledger/contract';

const ALLIANCE = ['Dwarf', 'Gnome', 'Human', 'Night Elf'];
const HORDE = ['Orc', 'Tauren', 'Troll', 'Undead'];

function quest(raceRestriction: string[] | null): EnrichedDungeonQuestDto {
    return {
        questId: 1, dungeonInstanceId: 100, name: 'Q', questLevel: 20, requiredLevel: 15, expansion: 'classic',
        questGiverNpc: null, questGiverZone: null, prevQuestId: null, nextQuestId: null, rewardsJson: null,
        objectives: null, classRestriction: null, raceRestriction, startsInsideDungeon: false, sharable: true,
        rewardXp: null, rewardGold: null, rewardType: null, rewards: null, prerequisiteChain: null,
    };
}

describe('factionOfRace / characterSide', () => {
    it('maps display names and addon tokens to a side', () => {
        expect(factionOfRace('Night Elf')).toBe('alliance');
        expect(factionOfRace('Scourge')).toBe('horde');
        expect(factionOfRace('Pandaren')).toBeNull();
    });

    it('prefers the race, falls back to the faction column, else null', () => {
        expect(characterSide('Orc', 'alliance')).toBe('horde');
        expect(characterSide(null, 'Alliance')).toBe('alliance');
        expect(characterSide(null, null)).toBeNull();
    });
});

describe('isQuestUsableBySide', () => {
    it('drops the other faction’s quest', () => {
        expect(isQuestUsableBySide(quest(ALLIANCE), 'horde')).toBe(false);
        expect(isQuestUsableBySide(quest(HORDE), 'horde')).toBe(true);
    });

    it('keeps neutral quests (null or empty race list) for either side', () => {
        expect(isQuestUsableBySide(quest(null), 'horde')).toBe(true);
        expect(isQuestUsableBySide(quest([]), 'alliance')).toBe(true);
    });

    it('keeps every quest when the side is unknown', () => {
        expect(isQuestUsableBySide(quest(ALLIANCE), null)).toBe(true);
        expect(isQuestUsableBySide(quest(HORDE), null)).toBe(true);
    });
});

describe('isQuestUsable — raceless character (ROK-2211)', () => {
    it('filters by the side when the race is null', () => {
        expect(isQuestUsable(quest(ALLIANCE), 'Warrior', null, 'horde')).toBe(false);
        expect(isQuestUsable(quest(HORDE), 'Warrior', null, 'horde')).toBe(true);
        expect(isQuestUsable(quest(null), 'Warrior', null, 'horde')).toBe(true);
    });

    it('keeps both factions when neither race nor side is known', () => {
        expect(isQuestUsable(quest(ALLIANCE), 'Warrior', null)).toBe(true);
        expect(isQuestUsable(quest(HORDE), 'Warrior', null, null)).toBe(true);
    });
});
