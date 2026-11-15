/** ROK-2207 — the guild-faction quest filter (pure). */
import { describe, it, expect } from 'vitest';
import { hiddenNote, questsForGuild, type QuestFaction } from './planner-faction';

const q = (questId: number, name: string, faction: QuestFaction): { questId: number; name: string; faction: QuestFaction } =>
    ({ questId, name, faction });

const QUESTS = [
    q(1, "The Archmage's Errand", 'alliance'),
    q(2, "The Archmage's Errand", 'horde'),
    q(3, 'Arcane Remnants', 'neutral'),
    q(4, 'Sunreaver Orders', 'horde'),
    q(5, 'Silver Covenant Dispatch', 'alliance'),
];

describe('questsForGuild', () => {
    it('an Alliance guild sees Alliance + neutral quests and none of the Horde ones', () => {
        const r = questsForGuild(QUESTS, 'alliance');
        expect(r.shown.map((x) => x.questId)).toEqual([1, 3, 5]);
        expect(r.hidden).toBe(2);
    });

    it('a Horde guild sees Horde + neutral quests and none of the Alliance ones', () => {
        const r = questsForGuild(QUESTS, 'horde');
        expect(r.shown.map((x) => x.questId)).toEqual([2, 3, 4]);
        expect(r.hidden).toBe(2);
    });

    it('keeps neutral quests for either faction', () => {
        const neutral = [q(3, 'Arcane Remnants', 'neutral'), q(6, 'Whispers Below', 'neutral')];
        expect(questsForGuild(neutral, 'alliance')).toEqual({ shown: neutral, hidden: 0 });
        expect(questsForGuild(neutral, 'horde')).toEqual({ shown: neutral, hidden: 0 });
    });

    it('keeps only the guild’s own version of a same-name pair', () => {
        const errands = questsForGuild(QUESTS, 'alliance').shown.filter((x) => x.name === "The Archmage's Errand");
        expect(errands.map((x) => x.questId)).toEqual([1]);
    });
});

describe('hiddenNote', () => {
    it('names the other faction and the guild’s, or null when nothing is hidden', () => {
        expect(hiddenNote(2, 'alliance')).toBe('2 Horde quests hidden — this is an Alliance guild.');
        expect(hiddenNote(1, 'horde')).toBe('1 Alliance quest hidden — this is a Horde guild.');
        expect(hiddenNote(0, 'alliance')).toBeNull();
    });
});
