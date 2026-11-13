/**
 * ROK-1790 — pure helpers behind the WoW: Forever Crafters tab.
 */
import { describe, it, expect } from 'vitest';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type { RosterProfession } from '../../hub-widgets/professions.helpers';
import {
    EMPTY_CRAFTER_FILTERS, MIN_SKILL_OPTIONS, activeCount, canSeeCrafters, filterCrafters, professionOptions,
    type CrafterFilters,
} from './crafters.helpers';

const PROFESSIONS: RosterProfession[] = [
    { name: 'Alchemy', members: [
        { characterId: 'a1', name: 'Brewa', skill: 225, maxSkill: 300, source: 'blizzard' },
        { characterId: 'a2', name: 'Thrall', skill: 300, maxSkill: 300, source: 'manual' },
        { characterId: null, memberId: 9, name: 'Ghost', skill: null, maxSkill: null, source: 'roster' },
    ] },
    { name: 'Mining', members: [
        { characterId: 'a2', name: 'Thrall', skill: 150, maxSkill: 150, source: 'blizzard' },
    ] },
];

const names = (list: readonly RosterProfession[]): string[] => list.map((p) => p.name);
const membersOf = (list: readonly RosterProfession[], name: string): string[] =>
    (list.find((p) => p.name === name)?.members ?? []).map((m) => m.name);

describe('filterCrafters', () => {
    it('keeps every profession, members sorted by skill high to low, with no query or filters', () => {
        const out = filterCrafters(PROFESSIONS, '', EMPTY_CRAFTER_FILTERS);
        expect(names(out)).toEqual(['Alchemy', 'Mining']);
        expect(membersOf(out, 'Alchemy')).toEqual(['Thrall', 'Brewa', 'Ghost']);
    });

    it('a profession-name search keeps all of that profession’s crafters', () => {
        const out = filterCrafters(PROFESSIONS, '  ALCH ', EMPTY_CRAFTER_FILTERS);
        expect(names(out)).toEqual(['Alchemy']);
        expect(membersOf(out, 'Alchemy')).toEqual(['Thrall', 'Brewa', 'Ghost']);
    });

    it('a character-name search narrows each card to the matching crafters', () => {
        const out = filterCrafters(PROFESSIONS, 'thr', EMPTY_CRAFTER_FILTERS);
        expect(names(out)).toEqual(['Alchemy', 'Mining']);
        expect(membersOf(out, 'Alchemy')).toEqual(['Thrall']);
    });

    it('a search that matches nothing returns an empty list', () => {
        expect(filterCrafters(PROFESSIONS, 'zzz', EMPTY_CRAFTER_FILTERS)).toEqual([]);
    });

    it('the profession filter keeps only the chosen professions (OR within the group)', () => {
        const filters: CrafterFilters = { ...EMPTY_CRAFTER_FILTERS, professions: ['Mining'] };
        expect(names(filterCrafters(PROFESSIONS, '', filters))).toEqual(['Mining']);
    });

    it('minimum skill drops lower and unknown skills, and drops a profession left empty', () => {
        const out = filterCrafters(PROFESSIONS, '', { ...EMPTY_CRAFTER_FILTERS, minSkill: 225 });
        expect(names(out)).toEqual(['Alchemy']);
        expect(membersOf(out, 'Alchemy')).toEqual(['Thrall', 'Brewa']);
    });

    it('combines groups with AND: profession + minimum skill + search', () => {
        const filters: CrafterFilters = { professions: ['Alchemy', 'Mining'], minSkill: 300 };
        const out = filterCrafters(PROFESSIONS, 'brew', filters);
        expect(out).toEqual([]);
        expect(membersOf(filterCrafters(PROFESSIONS, 'thr', filters), 'Alchemy')).toEqual(['Thrall']);
    });
});

describe('activeCount', () => {
    it('counts active groups, not chosen values', () => {
        expect(activeCount(EMPTY_CRAFTER_FILTERS)).toBe(0);
        expect(activeCount({ professions: ['Alchemy', 'Mining'], minSkill: null })).toBe(1);
        expect(activeCount({ professions: ['Alchemy'], minSkill: 150 })).toBe(2);
    });
});

describe('MIN_SKILL_OPTIONS / professionOptions', () => {
    it('offers Any / 150+ / 225+ / 300 as in the approved mockup', () => {
        expect(MIN_SKILL_OPTIONS.map((o) => [o.label, o.value])).toEqual([['Any', null], ['150+', 150], ['225+', 225], ['300', 300]]);
    });

    it('lists profession names A–Z', () => {
        expect(professionOptions([...PROFESSIONS].reverse())).toEqual(['Alchemy', 'Mining']);
    });
});

describe('canSeeCrafters', () => {
    const member = { role: 'member' } as const;
    const withProfessions = (professions: WowRosterInsightsDto['professions']): Pick<WowRosterInsightsDto, 'professions'> =>
        (professions === undefined ? {} : { professions });

    it('hides the tab from a visitor who is not staff', () => {
        expect(canSeeCrafters({ role: 'visitor' }, undefined)).toBe(false);
    });

    it('shows it to non-member staff and to members while the payload is not loaded yet', () => {
        expect(canSeeCrafters({ role: 'visitor', isStaff: true }, undefined)).toBe(true);
        expect(canSeeCrafters(member, undefined)).toBe(true);
    });

    it('shows it once the guild has any profession data, hides it when there is none', () => {
        expect(canSeeCrafters(member, withProfessions(PROFESSIONS))).toBe(true);
        expect(canSeeCrafters(member, withProfessions([]))).toBe(false);
        expect(canSeeCrafters(member, withProfessions(undefined))).toBe(false);
    });
});
