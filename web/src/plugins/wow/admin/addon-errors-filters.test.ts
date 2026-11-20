/** ROK-2099 — filter state → API filters, option lists, summary line, last-seen labels. */
import { describe, expect, it } from 'vitest';
import type { AddonErrorGroupDto } from '@raid-ledger/contract';
import {
    ADDON_ERRORS_QUERY_MAX, EMPTY_ADDON_ERROR_FILTERS, activeFilterCount, addonOptions, formatSeen, memberOptions, optionGroups, summaryLine, toApiFilters,
} from './addon-errors-filters';

const g = (addon: string, members: [number, string][], totalCount: number): AddonErrorGroupDto => ({
    signature: 'a'.repeat(64), addon, message: 'm', members: members.map(([userId, username]) => ({ userId, username })),
    characters: [], totalCount, firstSeenAt: '2026-11-01T00:00:00Z', lastSeenAt: '2026-11-02T00:00:00Z', sampleStack: null,
});

describe('addon-errors filters (ROK-2099)', () => {
    it('omits unset filters and turns "last 7 days" into a since instant', () => {
        expect(toApiFilters(EMPTY_ADDON_ERROR_FILTERS, '  ')).toEqual({});
        const now = new Date('2026-11-19T12:00:00Z');
        expect(toApiFilters({ addon: 'Questie', userId: '3', lastSeen: '7' }, ' nil ', now))
            .toEqual({ addon: 'Questie', userId: 3, since: '2026-11-12T12:00:00.000Z', q: 'nil' });
        expect(activeFilterCount({ addon: 'Questie', userId: '', lastSeen: '30' })).toBe(2);
    });

    it('lists addons and members A–Z from the loaded groups, keeping the selection', () => {
        const groups = [g('Questie', [[2, 'Bea']], 1), g('BuffRadar', [[1, 'Al'], [2, 'Bea']], 1)];
        expect(addonOptions(groups, 'Zed').map((o) => o.value)).toEqual(['BuffRadar', 'Questie', 'Zed']);
        expect(memberOptions(groups, '')).toEqual([{ value: '1', label: 'Al' }, { value: '2', label: 'Bea' }]);
    });

    it('summarises distinct errors, occurrences and members', () => {
        const items = [g('Questie', [[2, 'Bea']], 14), g('Mailworthy', [[1, 'Al'], [2, 'Bea']], 38)];
        expect(summaryLine({ items, total: 2, page: 1, pageSize: 25 })).toBe('2 distinct errors · 52 occurrences · 2 members');
        expect(summaryLine({ items: [g('Questie', [[2, 'Bea']], 1)], total: 1, page: 1, pageSize: 25 }))
            .toBe('1 distinct error · 1 occurrence · 1 member');
    });

    it('caps a pasted search at the API query limit so the list and export do not 400', () => {
        const q = toApiFilters(EMPTY_ADDON_ERROR_FILTERS, `  ${'x'.repeat(250)}  `).q;
        expect(q).toHaveLength(ADDON_ERRORS_QUERY_MAX);
    });

    it('keeps every unfiltered addon and member as an option once the list is filtered to one addon', () => {
        const unfiltered = [g('Questie', [[2, 'Bea']], 14), g('DBM-Core', [[1, 'Al']], 2), g('Details', [[3, 'Cy']], 1)];
        const filtered = [g('DBM-Core', [[1, 'Al']], 2)];
        expect(addonOptions(optionGroups(unfiltered, filtered), 'DBM-Core').map((o) => o.value))
            .toEqual(['DBM-Core', 'Details', 'Questie']);
        expect(memberOptions(optionGroups(unfiltered, filtered), '').map((o) => o.label)).toEqual(['Al', 'Bea', 'Cy']);
    });

    it('says "on this page" when more groups match than the page holds', () => {
        const items = Array.from({ length: 25 }, () => g('Questie', [[1, 'Al']], 1));
        expect(summaryLine({ items, total: 26, page: 1, pageSize: 25 }))
            .toBe('26 distinct errors · 25 occurrences · 1 member on this page');
    });

    it('labels last-seen as Today / Yesterday / a short date', () => {
        const now = new Date(2026, 10, 19, 15, 0);
        expect(formatSeen(new Date(2026, 10, 19, 13, 49).toISOString(), now)).toMatch(/^Today 13:49$/);
        expect(formatSeen(new Date(2026, 10, 18, 21, 2).toISOString(), now)).toMatch(/^Yesterday 21:02$/);
        expect(formatSeen(new Date(2026, 10, 2, 9, 0).toISOString(), now)).not.toMatch(/Today|Yesterday/);
    });
});
