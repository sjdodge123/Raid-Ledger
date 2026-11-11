import { describe, expect, it } from 'vitest';
import {
    bg3ClassesLabel,
    bg3ClassLabel,
    bg3OriginLabel,
    bg3RaceLabel,
    bg3SummonName,
    bg3SummonsLine,
    humaniseBg3Id,
} from '../bg3-labels.js';

describe('bg3-labels (contract, ROK-2153 S6)', () => {
    it('humanises raw ids', () => {
        expect(humaniseBg3Id('GloomStalker')).toBe('Gloom Stalker');
    });

    it('labels race, class and origin', () => {
        expect(bg3RaceLabel('Elf_WoodElf')).toBe('Wood Elf');
        expect(bg3RaceLabel('HalfElf_High')).toBe('High Half-Elf');
        expect(bg3ClassLabel({ main: 'Barbarian', sub: 'BerserkerPath' })).toBe('Barbarian (Berserker)');
        expect(bg3ClassesLabel([{ main: 'Wizard', sub: null }, { main: 'Rogue', sub: 'Thief' }])).toBe(
            'Wizard + Rogue (Thief)',
        );
        expect(bg3OriginLabel('Generic')).toBe('Custom character');
        expect(bg3OriginLabel('ShadowHeart')).toBe('Origin: Shadow Heart');
    });

    it('names summons', () => {
        expect(bg3SummonName('DogFamiliar_Scratch_Summon')).toBe('Scratch');
        expect(bg3SummonsLine([{ origin: 'DogFamiliar_Scratch_Summon', isSummon: true }])).toBe('+1 summon: Scratch');
        expect(bg3SummonsLine([])).toBeNull();
    });
});
