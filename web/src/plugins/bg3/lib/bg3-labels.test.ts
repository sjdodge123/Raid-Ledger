import { describe, expect, it } from 'vitest';
import {
    bg3ClassesLabel,
    bg3OriginLabel,
    bg3RaceLabel,
    bg3SummonName,
    bg3SummonsLine,
    humaniseBg3Id,
} from './bg3-labels';

describe('bg3-labels (D-7)', () => {
    it('splits camelCase and underscores', () => {
        expect(humaniseBg3Id('GloomStalker')).toBe('Gloom Stalker');
        expect(humaniseBg3Id('SCL_Main_A')).toBe('SCL Main A');
    });

    it('reads the subrace first and drops a repeated word', () => {
        expect(bg3RaceLabel('Elf_WoodElf')).toBe('Wood Elf');
        expect(bg3RaceLabel('Tiefling_Asmodeus')).toBe('Asmodeus Tiefling');
        expect(bg3RaceLabel('Dwarf_Gold')).toBe('Gold Dwarf');
        expect(bg3RaceLabel('Human')).toBe('Human');
    });

    it('uses the override map for a seen id that humanises wrongly', () => {
        expect(bg3RaceLabel('HalfElf_High')).toBe('High Half-Elf');
    });

    it('labels class + subclass per entry, with seen-suffix overrides', () => {
        expect(bg3ClassesLabel([
            { main: 'Ranger', sub: 'GloomStalker' },
            { main: 'Rogue', sub: 'Thief' },
        ])).toBe('Ranger (Gloom Stalker) + Rogue (Thief)');
        expect(bg3ClassesLabel([{ main: 'Wizard', sub: 'NecromancySchool' }])).toBe('Wizard (Necromancy)');
        expect(bg3ClassesLabel([{ main: 'Cleric', sub: null }])).toBe('Cleric');
    });

    it('humanises an unknown id instead of dropping it', () => {
        expect(bg3ClassesLabel([{ main: 'Sorcerer', sub: 'WildMagic' }])).toBe('Sorcerer (Wild Magic)');
        expect(bg3RaceLabel('Gnome_Rock')).toBe('Rock Gnome');
    });

    it('labels origins: Generic is a custom character, others are humanised', () => {
        expect(bg3OriginLabel('Generic')).toBe('Custom character');
        expect(bg3OriginLabel('ShadowHeart')).toBe('Origin: Shadow Heart');
    });

    it('strips the summon suffix and type prefix', () => {
        expect(bg3SummonName('DogFamiliar_Scratch_Summon')).toBe('Scratch');
        expect(bg3SummonsLine([
            { origin: 'Generic', isSummon: false },
            { origin: 'DogFamiliar_Scratch_Summon', isSummon: true },
        ])).toBe('+1 summon: Scratch');
        expect(bg3SummonsLine([{ origin: 'Generic', isSummon: false }])).toBeNull();
    });
});
