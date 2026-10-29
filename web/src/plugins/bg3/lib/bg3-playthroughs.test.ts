/** ROK-1958 add-saves ruling (2026-10-29): saves group by campaign key = one playthrough. */
import { describe, expect, it } from 'vitest';
import { buildBg3MySave } from '../../../test/factories/bg3';
import { addPlaythroughsLabel, addSavesMoveNote, groupByPlaythrough, saveCountLabel, uniquePlaythroughLabels } from './bg3-playthroughs';

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

describe('capped counts (the page walk hit its safety stop)', () => {
    it('reads "M+ saves" so a cut list never undercounts', () => {
        expect(saveCountLabel(40, true)).toBe('40+ saves');
        expect(addPlaythroughsLabel(1, 40, true)).toBe('Add 1 playthrough · 40+ saves');
    });
});

describe('addSavesMoveNote', () => {
    it('pluralises with the number of playthroughs ticked', () => {
        expect(addSavesMoveNote(1)).toBe('Saves from this playthrough already in another campaign move here too.');
        expect(addSavesMoveNote(2)).toBe('Saves from these playthroughs already in another campaign move here too.');
    });
});

describe('uniquePlaythroughLabels', () => {
    const area = (s: { area: string | null }): string => s.area ?? 'none';
    it('keeps the newest save name when it is unique', () => {
        const groups = groupByPlaythrough([
            buildBg3MySave({ id: 1, campaignKey: A, saveName: 'QuickSave_2' }),
            buildBg3MySave({ id: 2, campaignKey: B, saveName: 'AutoSave_9' }),
        ]);
        expect(uniquePlaythroughLabels(groups, area)).toEqual(['QuickSave_2', 'AutoSave_9']);
    });

    it('adds the detail to clashing names, then numbers any that still clash', () => {
        const C = 'c'.repeat(64);
        const groups = groupByPlaythrough([
            buildBg3MySave({ id: 1, campaignKey: A, saveName: 'QuickSave', area: 'Grove', savedAt: '2026-10-23T00:00:00.000Z' }),
            buildBg3MySave({ id: 2, campaignKey: B, saveName: 'QuickSave', area: 'Camp', savedAt: '2026-10-22T00:00:00.000Z' }),
            buildBg3MySave({ id: 3, campaignKey: C, saveName: 'QuickSave', area: 'Camp', savedAt: '2026-10-21T00:00:00.000Z' }),
        ]);
        const labels = uniquePlaythroughLabels(groups, area);
        expect(labels).toEqual(['QuickSave · Grove', 'QuickSave · Camp (1)', 'QuickSave · Camp (2)']);
        expect(new Set(labels).size).toBe(3);
    });
});
