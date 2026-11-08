import { describe, expect, it } from 'vitest';
import type { ProfessionEntryDto, ProfessionTierDto } from '@raid-ledger/contract';
import { effectiveProfessionSkill, hasOnlyRedundantTier } from './profession-skill';

function tier(name: string, skillLevel: number, maxSkillLevel: number): ProfessionTierDto {
    return { id: 1, name, skillLevel, maxSkillLevel };
}

function entry(skillLevel: number, maxSkillLevel: number, tiers: ProfessionTierDto[]): ProfessionEntryDto {
    return { id: 186, name: 'Mining', slug: 'mining', skillLevel, maxSkillLevel, tiers };
}

describe('effectiveProfessionSkill', () => {
    it('falls back to the tier pair when the header is 0/0', () => {
        expect(effectiveProfessionSkill(entry(0, 0, [tier('Mining', 95, 150)]))).toEqual({
            skillLevel: 95,
            maxSkillLevel: 150,
        });
    });

    it('keeps an explicit 0 skill with a nonzero max instead of mixing in the tier', () => {
        expect(effectiveProfessionSkill(entry(0, 100, [tier('Mining', 300, 300)]))).toEqual({
            skillLevel: 0,
            maxSkillLevel: 100,
        });
    });

    it('keeps an explicit skill with a 0 max instead of mixing in the tier', () => {
        expect(effectiveProfessionSkill(entry(40, 0, [tier('Mining', 300, 300)]))).toEqual({
            skillLevel: 40,
            maxSkillLevel: 0,
        });
    });

    it('stays 0/0 with no tiers', () => {
        expect(effectiveProfessionSkill(entry(0, 0, []))).toEqual({ skillLevel: 0, maxSkillLevel: 0 });
    });
});

describe('hasOnlyRedundantTier', () => {
    it('ignores case and surrounding whitespace when comparing names', () => {
        expect(hasOnlyRedundantTier(entry(1, 1, [tier(' mining ', 1, 1)]))).toBe(true);
    });

    it('is false for a differing tier name', () => {
        expect(hasOnlyRedundantTier(entry(1, 1, [tier('Classic Mining', 1, 1)]))).toBe(false);
    });
});
