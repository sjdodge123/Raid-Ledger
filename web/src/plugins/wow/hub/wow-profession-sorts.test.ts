/**
 * ROK-2281 — the per-profession "Sort by" options: the comparator (high→low,
 * low→high, a member without a skill number last BOTH ways, ties left to
 * core's name order) and the option list (none without a picked pill, a pair
 * per picked pill in pick order, exact labels).
 */
import { describe, it, expect } from 'vitest';
import type { HubMemberRow } from '../../hub-module';
import { sortMembers } from '../../../components/hub/hub-members.helpers';
import type { WowRosterProfession } from './wow-member-filters.helpers';
import { buildProfessionSkillIndex, professionSortId, professionSorts } from './wow-profession-sorts';

const UUID = {
    a: '11111111-1111-4111-8111-111111111111',
    b: '22222222-2222-4222-8222-222222222222',
    c: '33333333-3333-4333-8333-333333333333',
    d: '44444444-4444-4444-8444-444444444444',
} as const;

function row(memberId: number, name: string, characterId: string | null): HubMemberRow {
    return { memberId, name, class: 'Warrior', level: 60, rankIndex: 2, rankName: 'Raider', effectiveRole: null, characterId, isMain: false };
}

const ROWS: readonly HubMemberRow[] = [
    row(1, 'Brisa', UUID.a),
    row(2, 'Corvin', null), // unclaimed: keyed `m2`
    row(3, 'Aldren', UUID.b),
    row(4, 'Dainel', UUID.c), // Mining with no skill number
    row(5, 'Elowen', UUID.d), // no Mining at all
    row(6, 'Amber', null), // ties Brisa's 150
];

const PROFESSIONS: readonly WowRosterProfession[] = [
    { name: 'Mining', members: [
        { characterId: UUID.a, name: 'Brisa', skill: 150, maxSkill: 300, source: 'addon' },
        { characterId: null, memberId: 2, name: 'Corvin', skill: 275, maxSkill: 300, source: 'blizzard' },
        { characterId: UUID.b, name: 'Aldren', skill: 60, maxSkill: 150, source: 'manual' },
        { characterId: UUID.c, name: 'Dainel', skill: null, maxSkill: null, source: 'addon' },
        { characterId: null, memberId: 6, name: 'Amber', skill: 150, maxSkill: 300, source: 'blizzard' },
    ] },
    { name: 'Herbalism', members: [{ characterId: UUID.d, name: 'Elowen', skill: 200, maxSkill: 300, source: 'addon' }] },
];

const INDEX = buildProfessionSkillIndex(PROFESSIONS);

function sortedNames(label: string, selected: readonly string[] = ['Mining']): string[] {
    const sort = professionSorts(selected, INDEX).find((s) => s.label === label);
    if (!sort) throw new Error(`no "${label}" option`);
    return sortMembers(ROWS, sort).map((r) => r.name);
}

describe('profession sort comparator (ROK-2281)', () => {
    it('orders by the profession skill high→low, members without a skill number last', () => {
        expect(sortedNames('Mining high→low')).toEqual(['Corvin', 'Amber', 'Brisa', 'Aldren', 'Dainel', 'Elowen']);
    });

    it('orders low→high and still puts members without a skill number last (ruling 4)', () => {
        expect(sortedNames('Mining low→high')).toEqual(['Aldren', 'Amber', 'Brisa', 'Corvin', 'Dainel', 'Elowen']);
    });

    it('leaves equal skills (and the no-skill tail) to core’s name order', () => {
        const names = sortedNames('Mining high→low');
        expect(names.indexOf('Amber'), 'Amber and Brisa tie at 150 — A before B').toBeLessThan(names.indexOf('Brisa'));
        expect(names.slice(-2), 'no number (Dainel) and no Mining (Elowen) tie last, by name').toEqual(['Dainel', 'Elowen']);
    });

    it('reads each profession’s own skill', () => {
        expect(sortedNames('Herbalism high→low', ['Herbalism'])[0]).toBe('Elowen');
    });
});

describe('profession sort options (ROK-2281)', () => {
    it('offers nothing when no profession pill is picked (ruling 2)', () => {
        expect(professionSorts([], INDEX)).toEqual([]);
    });

    it('offers a high→low / low→high pair per picked pill, in pick order (ruling 1)', () => {
        const options = professionSorts(['Mining', 'Herbalism'], INDEX);
        expect(options.map((o) => o.label)).toEqual(['Mining high→low', 'Mining low→high', 'Herbalism high→low', 'Herbalism low→high']);
        expect(options.map((o) => o.id)).toEqual(['profession-mining-desc', 'profession-mining-asc', 'profession-herbalism-desc', 'profession-herbalism-asc']);
    });

    it('keeps a pill’s option ids when a different pill is unpicked, so core keeps that sort (ruling 3)', () => {
        const both = professionSorts(['Mining', 'Herbalism'], INDEX).map((o) => o.id);
        const miningOnly = professionSorts(['Mining'], INDEX).map((o) => o.id);
        expect(miningOnly).toEqual(['profession-mining-desc', 'profession-mining-asc']);
        expect(both, 'Mining’s ids are the same with or without Herbalism picked').toEqual(expect.arrayContaining(miningOnly));
    });

    it('slugs a multi-word profession into its id', () => {
        expect(professionSortId('First Aid', 'asc')).toBe('profession-first-aid-asc');
    });
});
