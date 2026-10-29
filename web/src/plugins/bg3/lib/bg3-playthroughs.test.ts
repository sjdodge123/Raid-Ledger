/** ROK-1958 add-saves ruling (2026-10-29): saves group by campaign key = one playthrough. */
import { describe, expect, it } from 'vitest';
import { buildBg3MySave } from '../../../test/factories/bg3';
import { addPlaythroughsLabel, groupByPlaythrough, saveCountLabel } from './bg3-playthroughs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('groupByPlaythrough', () => {
    it('groups by campaign key, newest save first, newest playthrough first', () => {
        const groups = groupByPlaythrough([
            buildBg3MySave({ id: 1, campaignKey: A, savedAt: '2026-10-20T00:00:00.000Z' }),
            buildBg3MySave({ id: 2, campaignKey: B, savedAt: '2026-10-22T00:00:00.000Z' }),
            buildBg3MySave({ id: 3, campaignKey: A, savedAt: '2026-10-21T00:00:00.000Z' }),
        ]);
        expect(groups.map((g) => g.campaignKey)).toEqual([B, A]);
        expect(groups[1]?.saves.map((s) => s.id)).toEqual([3, 1]);
        expect(groups[1]?.newest.id).toBe(3);
    });

    it('returns no groups for no saves', () => {
        expect(groupByPlaythrough([])).toEqual([]);
    });
});

describe('labels', () => {
    it('counts saves', () => {
        expect(saveCountLabel(1)).toBe('1 save');
        expect(saveCountLabel(14)).toBe('14 saves');
    });

    it('reads "Add N playthrough(s) · M saves"', () => {
        expect(addPlaythroughsLabel(1, 1)).toBe('Add 1 playthrough · 1 save');
        expect(addPlaythroughsLabel(1, 14)).toBe('Add 1 playthrough · 14 saves');
        expect(addPlaythroughsLabel(2, 3)).toBe('Add 2 playthroughs · 3 saves');
        expect(addPlaythroughsLabel(0, 0)).toBe('Add 0 playthroughs · 0 saves');
    });
});
