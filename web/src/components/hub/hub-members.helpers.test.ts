/**
 * ROK-1830 S3b — the Members list's pure parts: the search filter, the banding
 * a grouping column asks for, and the count line.
 */
import { describe, it, expect } from 'vitest';
import type { GuildMemberRow } from '@raid-ledger/contract';
import type { HubMemberColumn } from '../../plugins/hub-module';
import {
    bandMembers, CORE_MEMBER_SORTS, DEFAULT_MEMBER_SORT_ID, filterMembers, groupingColumn, isFlatMode, MEMBER_SORT_PRESETS,
    memberSortOptions, membersCountFor, membersCountLine, sortMembers,
} from './hub-members.helpers';

function row(memberId: number, name: string, rankName: string, cls: string): GuildMemberRow {
    return { memberId, name, class: cls, level: 60, rankIndex: memberId, rankName, effectiveRole: null, characterId: null, isMain: false };
}

const ROWS = [row(0, 'Grimtusk', 'Guild Master', 'Warrior'), row(1, 'Stormcall', 'Raider', 'Shaman'), row(2, 'Nolina', 'Raider', 'Warrior')];
const byRank = (r: GuildMemberRow) => ({ key: r.rankName ?? 'none', label: r.rankName ?? 'Unranked' });

describe('filterMembers', () => {
    it('matches the name case-insensitively when the module gives no search text', () => {
        expect(filterMembers(ROWS, 'storm').map((r) => r.name)).toEqual(['Stormcall']);
    });

    it('matches whatever text the module supplies, so a class search works', () => {
        const hits = filterMembers(ROWS, 'warrior', (r) => `${r.name} ${r.class ?? ''}`);
        expect(hits.map((r) => r.name), 'the class must be searchable when the module offers it').toEqual(['Grimtusk', 'Nolina']);
    });

    it('returns every row for a blank or whitespace query', () => {
        expect(filterMembers(ROWS, '   ')).toHaveLength(3);
    });
});

describe('bandMembers', () => {
    it('makes one unlabelled band when nothing groups the rows', () => {
        expect(bandMembers(ROWS, undefined)).toEqual([{ key: 'all', label: '', testId: 'guild-members-all', rows: ROWS }]);
    });

    it('bands by the grouping key in first-appearance order, keeping the module row order', () => {
        const bands = bandMembers(ROWS, byRank);
        expect(bands.map((b) => [b.label, b.rows.length])).toEqual([['Guild Master', 1], ['Raider', 2]]);
        expect(bands.map((b) => b.testId)).toEqual(['guild-group-Guild Master', 'guild-group-Raider']);
    });

    it('keeps a test id the module pins, so a renamed tab does not move an old selector', () => {
        const bands = bandMembers(ROWS, (r) => ({ ...byRank(r), testId: `guild-rank-${r.memberId}` }));
        expect(bands[0]?.testId).toBe('guild-rank-0');
    });

    it('bands nothing when there are no rows', () => {
        expect(bandMembers([], byRank)).toEqual([]);
    });
});

describe('groupingColumn + membersCountLine', () => {
    const columns: HubMemberColumn[] = [
        { id: 'name', header: 'Name', cell: () => null },
        { id: 'rank', header: 'Rank', cell: () => null, groupBy: byRank },
    ];

    it('finds the column that offers grouping', () => {
        expect(groupingColumn(columns)?.header).toBe('Rank');
        expect(groupingColumn([{ id: 'name', header: 'Name', cell: () => null }])).toBeUndefined();
    });

    it('names the narrowing only while the search hides rows', () => {
        expect(membersCountLine(142, 142)).toBe('142 members');
        expect(membersCountLine(7, 142)).toBe('7 of 142 members');
        expect(membersCountLine(1, 1)).toBe('1 member');
    });

    it('falls back to the page member count when no rows were sent (ROK-1831 visitor)', () => {
        expect(membersCountFor(0, 0, 3)).toBe('3 members');
        expect(membersCountFor(0, 0, 1)).toBe('1 member');
        expect(membersCountFor(2, 5, 9)).toBe('2 of 5 members');
    });
});

describe('isFlatMode (ROK-1173 D5)', () => {
    it.each([
        ['', 0, DEFAULT_MEMBER_SORT_ID, false],
        ['   ', 0, DEFAULT_MEMBER_SORT_ID, false],
        ['war', 0, DEFAULT_MEMBER_SORT_ID, true],
        ['', 1, DEFAULT_MEMBER_SORT_ID, true],
        ['', 0, 'name-asc', true],
        ['war', 2, 'level-desc', true],
    ])('query %j, %i active filters, sort %s → flat %s', (query, active, sortId, flat) => {
        expect(isFlatMode(query, active, sortId)).toBe(flat);
    });
});

/** Row with a level and an optional export presence. */
function lv(memberId: number, name: string, level: number | null, presence?: GuildMemberRow['presence']): GuildMemberRow {
    return { ...row(memberId, name, 'Raider', 'Warrior'), level, ...(presence ? { presence } : {}) };
}

const names = (rows: readonly GuildMemberRow[]): string[] => rows.map((r) => r.name);

describe('sortMembers (ROK-1173)', () => {
    const MIXED = [lv(1, 'Cora', 40), lv(2, 'abel', 60), lv(3, 'Bryn', 60), lv(4, 'Dax', null)];

    it('keeps the module order (same array) for the default sort', () => {
        const [first] = memberSortOptions('Rank');
        expect(sortMembers(MIXED, first)).toBe(MIXED);
        expect(sortMembers(MIXED, undefined)).toBe(MIXED);
    });

    it('sorts by name both ways, case-insensitively', () => {
        expect(names(sortMembers(MIXED, CORE_MEMBER_SORTS.nameAsc))).toEqual(['abel', 'Bryn', 'Cora', 'Dax']);
        expect(names(sortMembers(MIXED, CORE_MEMBER_SORTS.nameDesc))).toEqual(['Dax', 'Cora', 'Bryn', 'abel']);
    });

    it('sorts by level, breaking ties by name and putting an unknown level last both ways', () => {
        expect(names(sortMembers(MIXED, MEMBER_SORT_PRESETS.levelDesc))).toEqual(['abel', 'Bryn', 'Cora', 'Dax']);
        expect(names(sortMembers(MIXED, MEMBER_SORT_PRESETS.levelAsc))).toEqual(['Cora', 'abel', 'Bryn', 'Dax']);
    });

    it('sorts last seen: online first, then fewest days, unreported last (ties by name)', () => {
        const rows = [
            lv(1, 'Zed', 60),
            lv(2, 'Ivy', 60, { online: false, lastOnlineDays: 3 }),
            lv(3, 'Kai', 60, { online: true, lastOnlineDays: null }),
            lv(4, 'Ash', 60, { online: null, lastOnlineDays: null }),
            lv(5, 'Moe', 60, { online: false, lastOnlineDays: 0 }),
            lv(6, 'Bea', 60),
        ];
        expect(names(sortMembers(rows, MEMBER_SORT_PRESETS.lastSeen))).toEqual(['Kai', 'Moe', 'Ivy', 'Ash', 'Bea', 'Zed']);
    });

    it('is stable and does not mutate the input', () => {
        const rows = [lv(1, 'Same', 60), lv(2, 'Same', 60), lv(3, 'Same', 60)];
        const sorted = sortMembers(rows, MEMBER_SORT_PRESETS.levelDesc);
        expect(sorted.map((r) => r.memberId), 'equal rows must keep their incoming order').toEqual([1, 2, 3]);
        expect(rows.map((r) => r.memberId)).toEqual([1, 2, 3]);
    });
});

describe('memberSortOptions (ROK-1173)', () => {
    it('offers the module order named after its grouping column, the name sorts, then the module extras', () => {
        const opts = memberSortOptions('Rank', [MEMBER_SORT_PRESETS.lastSeen]);
        expect(opts.map((o) => [o.id, o.label])).toEqual([
            [DEFAULT_MEMBER_SORT_ID, 'Rank'], ['name-asc', 'Name A–Z'], ['name-desc', 'Name Z–A'], ['last-seen', 'Last seen'],
        ]);
        expect(memberSortOptions(null)[0]?.label).toBe('Default');
    });
});
