/** ROK-1958 add-saves ruling (2026-10-29): saves group by campaign key = one playthrough. */
import { describe, expect, it } from 'vitest';
import { buildBg3MySave } from '../../../test/factories/bg3';
import {
    addPlaythroughsLabel, addSavesMoveNote, bg3MonthLabel, groupByMonth, groupByPlaythrough, groupState, removePlaythroughsLabel,
    removePlaythroughsTitle, saveCountLabel, setGroup, uniquePlaythroughLabels,
} from './bg3-playthroughs';

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

describe('ROK-2068 groupByMonth', () => {
    // Mid-month noon UTC, so the local month is the same in every time zone.
    const at = (key: string, savedAt: string) => buildBg3MySave({ id: savedAt.length + key.charCodeAt(0), campaignKey: key.repeat(64), savedAt });
    const C = 'c';

    it('groups playthroughs by their newest save\'s month, months and rows newest first', () => {
        const playthroughs = groupByPlaythrough([
            at('a', '2024-08-14T12:00:00.000Z'),
            at('b', '2026-10-15T12:00:00.000Z'),
            at('c', '2024-08-16T12:00:00.000Z'),
            at('a', '2024-07-10T12:00:00.000Z'),
        ]);
        const months = groupByMonth(playthroughs);
        expect(months.map((m) => m.key)).toEqual(['2026-10', '2024-08']);
        expect(months[1]?.playthroughs.map((p) => p.campaignKey)).toEqual([C.repeat(64), A]);
        expect(months[1]?.label).toBe(bg3MonthLabel('2024-08-14T12:00:00.000Z'));
        expect(months[0]?.playthroughs).toHaveLength(1);
    });

    it('a playthrough spanning months sits under its newest save\'s month only', () => {
        const months = groupByMonth(groupByPlaythrough([at('a', '2024-07-10T12:00:00.000Z'), at('a', '2024-09-10T12:00:00.000Z')]));
        expect(months.map((m) => m.key)).toEqual(['2024-09']);
    });

    it('labels the month with its long name and year', () => {
        expect(bg3MonthLabel('2024-08-14T12:00:00.000Z')).toMatch(/2024/);
        expect(bg3MonthLabel('2024-08-14T12:00:00.000Z')).not.toBe(bg3MonthLabel('2024-09-14T12:00:00.000Z'));
    });

    it('returns no months for no playthroughs', () => {
        expect(groupByMonth([])).toEqual([]);
    });
});

describe('ROK-2068 remove labels', () => {
    it('counts playthroughs and saves on the destructive button', () => {
        expect(removePlaythroughsLabel(1, 1)).toBe('Remove 1 playthrough · 1 save');
        expect(removePlaythroughsLabel(6, 14)).toBe('Remove 6 playthroughs · 14 saves');
        expect(removePlaythroughsLabel(2, 40, true)).toBe('Remove 2 playthroughs · 40+ saves');
    });

    it('titles the confirm step', () => {
        expect(removePlaythroughsTitle(1)).toBe('Remove 1 playthrough?');
        expect(removePlaythroughsTitle(6)).toBe('Remove 6 playthroughs?');
    });
});

describe('ROK-2068 month-group selection', () => {
    const keys = ['k1', 'k2', 'k3'];

    it('is clear with none picked, indeterminate with some, checked with all', () => {
        expect(groupState(new Set(), keys)).toEqual({ checked: false, indeterminate: false });
        expect(groupState(new Set(['k2', 'other']), keys)).toEqual({ checked: false, indeterminate: true });
        expect(groupState(new Set(keys), keys)).toEqual({ checked: true, indeterminate: false });
        expect(groupState(new Set(), [])).toEqual({ checked: false, indeterminate: false });
    });

    it('adds a whole group and removes only that group, keeping other picks', () => {
        const on = setGroup(new Set(['other', 'k1']), keys, true);
        expect([...on].sort()).toEqual(['k1', 'k2', 'k3', 'other']);
        expect([...setGroup(on, keys, false)]).toEqual(['other']);
    });
});
