import { describe, expect, it } from 'vitest';
import { bg3MemberRoles, coverage } from './bg3-party-roles';

const member = (classes: { main: string; sub: string | null }[], isSummon = false) => ({ classes, isSummon });

function coveredRoles(party: ReturnType<typeof member>[]): string[] {
    return coverage(party).filter((c) => c.covered).map((c) => c.role);
}

describe('party roles (Q4)', () => {
    it('unions the roles of every class entry', () => {
        expect([...bg3MemberRoles([{ main: 'Paladin', sub: 'Vengeance' }, { main: 'Warlock', sub: 'Fiend' }])].sort())
            .toEqual(['arcane', 'face', 'healer', 'tank']);
    });

    it.each([
        ['Barbarian', ['tank']],
        ['Bard', ['arcane', 'face', 'healer']],
        ['Cleric', ['healer']],
        ['Druid', ['healer']],
        ['Fighter', ['tank']],
        ['Monk', []],
        ['Paladin', ['face', 'healer', 'tank']],
        ['Ranger', []],
        ['Rogue', []],
        ['Sorcerer', ['arcane', 'face']],
        ['Warlock', ['arcane', 'face']],
        ['Wizard', ['arcane']],
    ])('maps base class %s to %j', (main, roles) => {
        expect([...bg3MemberRoles([{ main, sub: null }])].sort()).toEqual(roles);
    });

    it.each([
        ['Fighter', 'EldritchKnight', ['arcane', 'tank']],
        ['Rogue', 'ArcaneTrickster', ['arcane']],
        ['Druid', 'CircleOfTheMoon', ['healer', 'tank']],
    ])('adds the %s subclass %s roles: %j', (main, sub, roles) => {
        expect([...bg3MemberRoles([{ main, sub }])].sort()).toEqual(roles);
    });

    it('covers a healer for a Druid-led party', () => {
        expect(coveredRoles([member([{ main: 'Druid', sub: 'CircleOfTheLand' }])])).toEqual(['healer']);
    });

    it('gives an unknown class no role', () => {
        expect(bg3MemberRoles([{ main: 'Artificer', sub: null }]).size).toBe(0);
    });

    it('covers the fixture party (Barbarian, Wizard, Ranger/Rogue, Paladin)', () => {
        const party = [
            member([{ main: 'Barbarian', sub: 'BerserkerPath' }]),
            member([{ main: 'Wizard', sub: 'NecromancySchool' }]),
            member([{ main: 'Ranger', sub: 'GloomStalker' }, { main: 'Rogue', sub: 'Thief' }]),
            member([{ main: 'Paladin', sub: 'Vengeance' }]),
        ];
        expect(coverage(party).map((c) => c.label)).toEqual(['Healer', 'Arcane', 'Tank', 'Face']);
        expect(coveredRoles(party)).toEqual(['healer', 'arcane', 'tank', 'face']);
    });

    it('reports gaps and ignores summons', () => {
        const party = [member([{ main: 'Fighter', sub: null }]), member([{ main: 'Wizard', sub: null }], true)];
        expect(coveredRoles(party)).toEqual(['tank']);
    });
});
