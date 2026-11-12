/**
 * ROK-1927 — the Attunements card's pure helpers: faction-variant grouping,
 * untracked exclusion (AC8), the muted row note, the "nobody has data" probe
 * and the oldest-capture footer freshness (AC9).
 */
import { describe, it, expect } from 'vitest';
import {
    attunedPct, attunementsFreshness, groupAttunements, nobodyHasQuestData, rowNote, untrackedCopy,
} from './attunements.helpers';
import {
    buildAttunementDef, buildAttunementMember, buildAttunementsSection, daysAgo, sampleAttunementDefs,
} from '../../../test/factories/forever-attunements';
import { must } from '../../../test/must';

describe('groupAttunements', () => {
    it('merges faction variants into one row per group, summing every count', () => {
        const rows = groupAttunements(sampleAttunementDefs());
        expect(rows.map((r) => r.groupKey)).toEqual(['mc', 'onyxia', 'bwl', 'naxx']);
        const mc = must(rows[0], 'mc row');
        expect(mc).toMatchObject({ instance: 'Molten Core', done: 12, inProgress: 6, notStarted: 12, noData: 0, total: 30 });
        expect(must(rows[1], 'onyxia row')).toMatchObject({ done: 5, inProgress: 9, total: 30 });
    });

    it('keeps an untracked group greyed with its reason and counts nothing for it', () => {
        const naxx = buildAttunementDef('naxx', {
            trackable: false, untrackedReason: 'needs reputation data', counts: { done: 3, inProgress: 1, notStarted: 2, noData: 0 },
        });
        const row = must(groupAttunements([naxx])[0], 'naxx row');
        expect(row).toMatchObject({ trackable: false, done: 0, inProgress: 0, total: 0 });
        expect(untrackedCopy(row)).toBe('Not tracked yet — needs reputation data');
        expect(untrackedCopy({ ...row, untrackedReason: null })).toBe('Not tracked yet');
    });
});

describe('row note and percentages', () => {
    const row = must(groupAttunements([buildAttunementDef('mc', {
        counts: { done: 3, inProgress: 1, notStarted: 5, noData: 21 },
    })])[0], 'row');

    it('lists in-progress then without-data members, dropping zero parts', () => {
        expect(rowNote(row, false)).toBe('1 in progress · 21 without data');
        expect(rowNote({ ...row, inProgress: 0 }, false)).toBe('21 without data');
        expect(rowNote({ ...row, inProgress: 0, noData: 0 }, false)).toBeNull();
    });

    it('drops "without data" when the whole card already says nobody has data', () => {
        expect(rowNote(row, true)).toBe('1 in progress');
    });

    it('measures attuned over the whole group, and an empty group is 0 (never NaN)', () => {
        expect(attunedPct(row)).toBeCloseTo(10);
        expect(attunedPct({ ...row, done: 0, total: 0 })).toBe(0);
    });
});

describe('nobodyHasQuestData', () => {
    it('is true only when every tracked group is all no-data', () => {
        const allNoData = groupAttunements([buildAttunementDef('mc', { counts: { done: 0, inProgress: 0, notStarted: 0, noData: 30 } })]);
        expect(nobodyHasQuestData(allNoData)).toBe(true);
        expect(nobodyHasQuestData(groupAttunements(sampleAttunementDefs()))).toBe(false);
    });

    it('is false when only untracked groups exist', () => {
        expect(nobodyHasQuestData(groupAttunements([buildAttunementDef('naxx', { trackable: false })]))).toBe(false);
    });
});

describe('attunementsFreshness', () => {
    it("takes the oldest capture and that member's source", () => {
        const old = daysAgo(20);
        const section = buildAttunementsSection({
            oldestAsOf: old,
            members: [buildAttunementMember({ asOf: daysAgo(1), source: 'addon' }), buildAttunementMember({ asOf: old, source: 'blizzard' })],
        });
        expect(attunementsFreshness(section)).toEqual({ source: 'blizzard', asOf: old });
    });

    it('is null when no member has quest data', () => {
        const section = buildAttunementsSection({
            oldestAsOf: null, members: [buildAttunementMember({ asOf: null, source: null })],
        });
        expect(attunementsFreshness(section)).toBeNull();
    });
});
