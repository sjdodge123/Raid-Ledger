/** ROK-1953 W9 — Steam card helpers at their edges. */
import { describe, expect, it } from 'vitest';
import { maskedUnlock, namedUnlock, steamMember } from '../../../test/mocks/hub-steam-stats-handlers';
import {
    achievementA11y, achievementName, hoursLabel, isRare, missingLine, nobodyLinked, pctLabel, playtimeRows, raceRows, unlockKeys,
} from './steam-stats.helpers';

describe('steam-stats helpers (W9)', () => {
    it('hoursLabel rounds to whole hours and floors sub-hour play to "< 1 h"', () => {
        expect(hoursLabel(0)).toBe('< 1 h');
        expect(hoursLabel(59)).toBe('< 1 h');
        expect(hoursLabel(60)).toBe('1 h');
        expect(hoursLabel(7260)).toBe('121 h');
        expect(hoursLabel(90_000)).toBe('1,500 h');
    });

    it('pctLabel: one decimal under 10, whole from 10, empty for unknown', () => {
        expect(pctLabel(3.21)).toBe('3.2%');
        expect(pctLabel(0)).toBe('0.0%');
        expect(pctLabel(10)).toBe('10%');
        expect(pctLabel(89.4)).toBe('89%');
        expect(pctLabel(null)).toBe('');
    });

    it('isRare is strictly under 10% and false for unknown', () => {
        expect(isRare(9.99)).toBe(true);
        expect(isRare(10)).toBe(false);
        expect(isRare(null)).toBe(false);
    });

    it('a masked achievement is named only "Hidden achievement"', () => {
        const masked = maskedUnlock(1, 3.2, '2026-10-24T20:00:00.000Z').achievement;
        expect(achievementName(masked)).toBe('Hidden achievement');
        expect(achievementA11y(masked)).toBe('Hidden achievement, 3.2% of players');
        expect(achievementA11y({ masked: true, globalPct: null })).toBe('Hidden achievement');
        expect(achievementName(namedUnlock(2, 'Jack-of-all-Trades', 3.2, '2026-10-24T20:00:00.000Z').achievement)).toBe('Jack-of-all-Trades');
    });

    it('raceRows keeps only ok members with a count, as a share of the total', () => {
        const rows = raceRows([
            steamMember(1, { unlockedCount: 27 }), steamMember(2, { status: 'private', unlockedCount: null }),
            steamMember(3, { status: 'pending', unlockedCount: null }),
        ], 54);
        expect(rows.map((r) => [r.member.userId, r.value, r.pct])).toEqual([[1, '27 / 54', 50]]);
        expect(raceRows([steamMember(1, { unlockedCount: 0 })], 0)[0]?.pct).toBe(0);
    });

    it('playtimeRows sorts most first, drops null/zero, scales to the top row', () => {
        const rows = playtimeRows([
            steamMember(1, { playtimeMinutes: 600 }), steamMember(2, { playtimeMinutes: 1200 }),
            steamMember(3, { playtimeMinutes: 0 }), steamMember(4, { playtimeMinutes: null }),
        ]);
        expect(rows.map((r) => [r.member.userId, r.value, r.pct])).toEqual([[2, '20 h', 100], [1, '10 h', 50]]);
        expect(playtimeRows([])).toEqual([]);
    });

    it('missingLine counts unlinked (singular/plural) and optionally private', () => {
        const members = [steamMember(1, { status: 'unlinked' }), steamMember(2, { status: 'unlinked' }), steamMember(3, { status: 'private' })];
        expect(missingLine(members, true)).toBe("2 haven't linked Steam · 1 private");
        expect(missingLine(members, false)).toBe("2 haven't linked Steam");
        expect(missingLine([steamMember(1, { status: 'unlinked' })], true)).toBe("1 hasn't linked Steam");
        expect(missingLine([steamMember(1)], true)).toBe('');
    });

    it('nobodyLinked is true only when every member is unlinked', () => {
        expect(nobodyLinked([steamMember(1, { status: 'unlinked' })])).toBe(true);
        expect(nobodyLinked([steamMember(1, { status: 'unlinked' }), steamMember(2, { status: 'private' })])).toBe(false);
    });
});

describe('unlockKeys (Codex P2)', () => {
    it('is unique for same-second unlocks by one player, masked or named', () => {
        const at = '2026-10-24T20:00:00.000Z';
        const keys = unlockKeys([maskedUnlock(1, 2.7, at), namedUnlock(1, 'Act One', 70, at), maskedUnlock(1, 18.6, at), maskedUnlock(2, 5, at)]);
        expect(keys).toEqual([`1-${at}-masked-0`, `1-${at}-ACT_ONE`, `1-${at}-masked-1`, `2-${at}-masked-0`]);
    });
});
