/**
 * ROK-2128 — pure helpers behind Add character → "Guild roster": search
 * filtering, the row meta line, the FLAG 4 ruleset default and the FLAG 9
 * default-tab rule.
 */
import { describe, it, expect } from 'vitest';
import type { CharacterDto, RosterClaimGuildDto } from '@raid-ledger/contract';
import { countCandidates, defaultClaimRuleset, filterRosterGuilds, rosterMetaLine, shouldDefaultToRoster } from './roster-claim';

const GUILDS: RosterClaimGuildDto[] = [
    { guildId: 1, guildName: 'Ledger Test Guild', region: 'us', candidates: [
        { memberId: 11, name: 'Ashen Vale', class: 'Mage', level: 60, source: 'addon_import' },
        { memberId: 12, name: 'Brine Hollow', class: 'Priest', level: 42, source: 'addon_import' },
    ] },
    { guildId: 2, guildName: 'Night Market', region: 'us', candidates: [
        { memberId: 21, name: 'Fernwhistle Thorne', class: 'Druid', level: 18, source: 'blizzard' },
    ] },
];

function char(over: Partial<CharacterDto>): CharacterDto {
    return { ruleset: null, isMain: false, ...over } as CharacterDto;
}

describe('filterRosterGuilds', () => {
    it('returns every guild for an empty query', () => {
        expect(filterRosterGuilds(GUILDS, '  ')).toEqual(GUILDS);
    });
    it('matches names case-insensitively and drops guilds left empty', () => {
        const out = filterRosterGuilds(GUILDS, 'fern');
        expect(out.map((g) => g.guildName)).toEqual(['Night Market']);
        expect(out[0]?.candidates.map((c) => c.name)).toEqual(['Fernwhistle Thorne']);
    });
    it('returns nothing when no row matches', () => {
        expect(filterRosterGuilds(GUILDS, 'zzz')).toEqual([]);
    });
});

describe('countCandidates', () => {
    it('sums candidates across guilds', () => {
        expect(countCandidates(GUILDS)).toBe(3);
        expect(countCandidates([])).toBe(0);
    });
});

describe('rosterMetaLine', () => {
    it('joins level and class', () => {
        expect(rosterMetaLine({ level: 60, class: 'Mage' })).toBe('Lv 60 · Mage');
    });
    it('drops a missing half', () => {
        expect(rosterMetaLine({ level: null, class: 'Mage' })).toBe('Mage');
        expect(rosterMetaLine({ level: 12, class: null })).toBe('Lv 12');
        expect(rosterMetaLine({ level: null, class: null })).toBe('');
    });
});

describe('defaultClaimRuleset (FLAG 4)', () => {
    it("uses the ruleset of the user's existing Forever character", () => {
        expect(defaultClaimRuleset([char({ ruleset: null }), char({ ruleset: 'pvp' })])).toBe('pvp');
    });
    it('falls back to normal with no Forever character', () => {
        expect(defaultClaimRuleset([])).toBe('normal');
    });
});

describe('shouldDefaultToRoster (FLAG 9)', () => {
    it('is true only for a user with no character of the game and a non-empty list', () => {
        expect(shouldDefaultToRoster([], 3)).toBe(true);
        expect(shouldDefaultToRoster([char({})], 3)).toBe(false);
        expect(shouldDefaultToRoster([], 0)).toBe(false);
    });
});
