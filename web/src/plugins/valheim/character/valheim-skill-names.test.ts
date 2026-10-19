import { describe, expect, it } from 'vitest';
import { sortSkillsByLevel, valheimSkillName } from './valheim-skill-names';

describe('valheimSkillName — D12', () => {
    it('maps vanilla ids to display names', () => {
        expect(valheimSkillName('WoodCutting')).toBe('Woodcutting');
        expect(valheimSkillName('ElementalMagic')).toBe('Elemental magic');
        expect(valheimSkillName('Swords')).toBe('Swords');
    });
    it('a numeric (modded) id reads "Modded skill <id>"', () => {
        expect(valheimSkillName('-1287461328')).toBe('Modded skill -1287461328');
    });
    it('an unknown text id is humanised', () => {
        expect(valheimSkillName('BeastTaming')).toBe('Beast taming');
        expect(valheimSkillName('rune_magic')).toBe('Rune magic');
    });
});

describe('sortSkillsByLevel', () => {
    it('orders by level desc, ties by name, without mutating the input', () => {
        const input = [
            { id: 'Run', level: 41, accumulator: 0 }, { id: 'Swords', level: 34.25, accumulator: 0 },
            { id: 'Axes', level: 41, accumulator: 0 }, { id: 'Jump', level: 12.1, accumulator: 0 },
        ];
        expect(sortSkillsByLevel(input).map((s) => s.id)).toEqual(['Axes', 'Run', 'Swords', 'Jump']);
        expect(input[0]?.id).toBe('Run');
    });
});
