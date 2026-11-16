/** ROK-2216 — the hidden-other-faction note (spec L10, wording keyed by `sideSource`). */
import { describe, it, expect } from 'vitest';
import { hiddenFactionNote } from './planner-faction';

describe('hiddenFactionNote', () => {
    it('uses guild wording only when the side came from the guild', () => {
        expect(hiddenFactionNote({ hiddenOtherFaction: 2, side: 'alliance', sideSource: 'guild' }))
            .toBe('2 Horde quests hidden — this is an Alliance guild.');
        expect(hiddenFactionNote({ hiddenOtherFaction: 1, side: 'horde', sideSource: 'guild' }))
            .toBe('1 Alliance quest hidden — this is a Horde guild.');
    });

    it("uses group wording when the side came from the characters", () => {
        expect(hiddenFactionNote({ hiddenOtherFaction: 3, side: 'horde', sideSource: 'characters' }))
            .toBe("3 Alliance quests hidden for this group's faction.");
        expect(hiddenFactionNote({ hiddenOtherFaction: 1, side: 'alliance', sideSource: 'characters' }))
            .toBe("1 Horde quest hidden for this group's faction.");
    });

    it('shows nothing when nothing was hidden or no side applied', () => {
        expect(hiddenFactionNote({ hiddenOtherFaction: 0, side: 'alliance', sideSource: 'guild' })).toBeNull();
        expect(hiddenFactionNote({ hiddenOtherFaction: 2, side: null, sideSource: null })).toBeNull();
    });
});
