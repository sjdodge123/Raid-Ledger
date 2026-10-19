/**
 * ROK-1830 S3b — the Members list's pure parts: the search filter, the banding
 * a grouping column asks for, and the count line.
 */
import { describe, it, expect } from 'vitest';
import type { GuildMemberRow } from '@raid-ledger/contract';
import type { HubMemberColumn } from '../../plugins/hub-module';
import { bandMembers, filterMembers, groupingColumn, membersCountFor, membersCountLine } from './hub-members.helpers';

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
