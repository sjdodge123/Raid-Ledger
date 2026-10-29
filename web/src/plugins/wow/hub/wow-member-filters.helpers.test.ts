/**
 * ROK-1173 (AC2, AC4) — the WoW Members filter helpers: each filter group,
 * AND across groups / OR within, the level clamp, the active-group count, the
 * Unknown role and the options derived from the roster.
 */
import { describe, it, expect } from 'vitest';
import type { HubMemberRow } from '../../hub-module';
import {
    EMPTY_WOW_MEMBER_FILTERS, WOW_MEMBER_SORTS, buildProfessionIndex, clampLevel, countActiveWowFilters,
    professionCoverage, toggleValue, wowFilterOptions, wowMemberMatches,
    type WowMemberFilterState, type WowRosterProfession,
} from './wow-member-filters.helpers';

const UUID = {
    a: '11111111-1111-4111-8111-111111111111',
    b: '22222222-2222-4222-8222-222222222222',
    c: '33333333-3333-4333-8333-333333333333',
} as const;

function row(overrides: Partial<HubMemberRow> & Pick<HubMemberRow, 'memberId' | 'name'>): HubMemberRow {
    return {
        class: 'Warrior', level: 60, rankIndex: 2, rankName: 'Raider', effectiveRole: null,
        characterId: null, isMain: false, ...overrides,
    };
}

const ROWS: readonly HubMemberRow[] = [
    row({ memberId: 1, name: 'Tankard', class: 'Warrior', level: 60, rankIndex: 0, rankName: 'Guild Master', effectiveRole: 'tank', characterId: UUID.a }),
    row({ memberId: 2, name: 'Mendy', class: 'Priest', level: 58, rankIndex: 1, rankName: 'Officer', effectiveRole: 'healer', characterId: UUID.b }),
    row({ memberId: 3, name: 'Arrow', class: 'Hunter', level: 42, rankIndex: 2, rankName: 'Raider', effectiveRole: 'dps', characterId: UUID.c }),
    row({ memberId: 4, name: 'Alty', class: 'Hunter', level: 12, rankIndex: 2, rankName: 'Raider' }),
    row({ memberId: 5, name: 'Mystery', class: null, level: null, rankIndex: null, rankName: null }),
];

const PROFESSIONS: readonly WowRosterProfession[] = [
    { name: 'Enchanting', members: [
        { characterId: UUID.a, name: 'Tankard', skill: 300, maxSkill: 300, source: 'addon' },
        { characterId: UUID.b, name: 'Mendy', skill: 120, maxSkill: 150, source: 'manual' },
    ] },
    { name: 'Mining', members: [{ characterId: UUID.c, name: 'Arrow', skill: 75, maxSkill: 150, source: 'addon' }] },
    { name: 'Fishing', members: [] },
];
const INDEX = buildProfessionIndex(PROFESSIONS);

function names(state: Partial<WowMemberFilterState>): string[] {
    const full = { ...EMPTY_WOW_MEMBER_FILTERS, ...state };
    return ROWS.filter((r) => wowMemberMatches(full, r, INDEX)).map((r) => r.name);
}

describe('wowMemberMatches — each filter group (ROK-1173 AC2)', () => {
    it('passes every row with no filters set', () => {
        expect(names({})).toEqual(['Tankard', 'Mendy', 'Arrow', 'Alty', 'Mystery']);
    });

    it('Class: OR within the group; a row with no class never matches a class filter', () => {
        expect(names({ classes: ['Hunter'] })).toEqual(['Arrow', 'Alty']);
        expect(names({ classes: ['Hunter', 'Priest'] })).toEqual(['Mendy', 'Arrow', 'Alty']);
    });

    it('Role: Unknown covers unlinked rows and rows with no role set', () => {
        expect(names({ roles: ['unknown'] })).toEqual(['Alty', 'Mystery']);
        expect(names({ roles: ['tank', 'healer'] })).toEqual(['Tankard', 'Mendy']);
        expect(names({ roles: ['dps', 'unknown'] })).toEqual(['Arrow', 'Alty', 'Mystery']);
    });

    it('Rank: matches the rank key, including the unranked "none" key', () => {
        expect(names({ ranks: ['2'] })).toEqual(['Arrow', 'Alty']);
        expect(names({ ranks: ['0', 'none'] })).toEqual(['Tankard', 'Mystery']);
    });

    it('Level: inclusive min/max; a row with no level fails once either bound is set', () => {
        expect(names({ levelMin: 42 })).toEqual(['Tankard', 'Mendy', 'Arrow']);
        expect(names({ levelMax: 42 })).toEqual(['Arrow', 'Alty']);
        expect(names({ levelMin: 40, levelMax: 59 })).toEqual(['Mendy', 'Arrow']);
    });

    it('Linked only: keeps rows with a linked RL character', () => {
        expect(names({ linkedOnly: true })).toEqual(['Tankard', 'Mendy', 'Arrow']);
    });

    it('Profession: OR within the group, joined by characterId; unlinked rows never match', () => {
        expect(names({ professions: ['Enchanting'] })).toEqual(['Tankard', 'Mendy']);
        expect(names({ professions: ['Enchanting', 'Mining'] })).toEqual(['Tankard', 'Mendy', 'Arrow']);
        expect(names({ professions: ['Fishing'] })).toEqual([]);
    });

    it('ANDs across groups', () => {
        expect(names({ classes: ['Hunter'], linkedOnly: true })).toEqual(['Arrow']);
        expect(names({ professions: ['Enchanting'], roles: ['healer'] })).toEqual(['Mendy']);
        expect(names({ classes: ['Hunter'], levelMin: 60 })).toEqual([]);
    });
});

describe('clampLevel (ROK-1173 AC2)', () => {
    it('clamps into 1..max level and rounds', () => {
        expect(clampLevel(0, 60)).toBe(1);
        expect(clampLevel(-5, 60)).toBe(1);
        expect(clampLevel(75, 60)).toBe(60);
        expect(clampLevel(42.6, 60)).toBe(43);
        expect(clampLevel(30, 60)).toBe(30);
    });

    it('keeps null / NaN as "no bound" and only floors at 1 with no roster level', () => {
        expect(clampLevel(null, 60)).toBeNull();
        expect(clampLevel(Number.NaN, 60)).toBeNull();
        expect(clampLevel(500, null)).toBe(500);
        expect(clampLevel(0, null)).toBe(1);
    });
});

describe('countActiveWowFilters (ROK-1173 AC3 badge)', () => {
    it('is 0 for the defaults and counts groups, not values', () => {
        expect(countActiveWowFilters(EMPTY_WOW_MEMBER_FILTERS)).toBe(0);
        expect(countActiveWowFilters({ ...EMPTY_WOW_MEMBER_FILTERS, classes: ['Hunter', 'Priest'] })).toBe(1);
    });

    it('counts level min + max as one group and every group once', () => {
        expect(countActiveWowFilters({ ...EMPTY_WOW_MEMBER_FILTERS, levelMin: 10, levelMax: 20 })).toBe(1);
        const all: WowMemberFilterState = {
            classes: ['Hunter'], roles: ['unknown'], ranks: ['2'], levelMin: 10, levelMax: null, linkedOnly: true, professions: ['Mining'],
        };
        expect(countActiveWowFilters(all)).toBe(6);
    });
});

describe('wowFilterOptions (ROK-1173 AC2)', () => {
    it('lists roster classes A–Z once, ranks in roster order, and the highest level', () => {
        const options = wowFilterOptions(ROWS);
        expect(options.classes).toEqual(['Hunter', 'Priest', 'Warrior']);
        expect(options.ranks).toEqual([
            { key: '0', label: 'Guild Master' }, { key: '1', label: 'Officer' },
            { key: '2', label: 'Raider' }, { key: 'none', label: 'Unranked' },
        ]);
        expect(options.maxLevel).toBe(60);
    });

    it('has no max level when no row reports one', () => {
        expect(wowFilterOptions([row({ memberId: 9, name: 'X', level: null })]).maxLevel).toBeNull();
    });
});

describe('professionCoverage / toggleValue / sorts', () => {
    it('keeps professions with members, most members first, then A–Z', () => {
        expect(professionCoverage(PROFESSIONS)).toEqual([{ name: 'Enchanting', count: 2 }, { name: 'Mining', count: 1 }]);
    });

    it('toggles a value in and out, keeping order', () => {
        expect(toggleValue(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
        expect(toggleValue(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    });

    it('offers Level high→low, Level low→high and Last seen (AC4)', () => {
        expect(WOW_MEMBER_SORTS.map((s) => s.id)).toEqual(['level-desc', 'level-asc', 'last-seen']);
    });
});
