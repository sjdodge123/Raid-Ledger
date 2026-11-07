import type { ProfessionEntryDto, ProfessionTierDto } from '@raid-ledger/contract';

/** The skill pair a profession header or badge shows. */
export interface ProfessionSkill {
    skillLevel: number;
    maxSkillLevel: number;
}

/** The tier with the highest max skill (the single tier when there is one). */
function headlineTier(tiers: ProfessionTierDto[]): ProfessionTierDto | undefined {
    return tiers.reduce<ProfessionTierDto | undefined>(
        (best, t) => (best === undefined || t.maxSkillLevel > best.maxSkillLevel ? t : best),
        undefined,
    );
}

/**
 * Header skill for a profession entry. Armory rows stored before the API
 * mapper read skill from `tiers[]` carry a 0/0 header, so fall back to the
 * headline tier until the next sync rewrites the row
 * (FOREVER-CHARPANEL-AUDIT §3).
 */
export function effectiveProfessionSkill(entry: ProfessionEntryDto): ProfessionSkill {
    const tier = headlineTier(entry.tiers);
    return {
        skillLevel: entry.skillLevel || (tier?.skillLevel ?? 0),
        maxSkillLevel: entry.maxSkillLevel || (tier?.maxSkillLevel ?? 0),
    };
}

/** True when the only tier just repeats the profession (Forever: "Mining" under "Mining"). */
export function hasOnlyRedundantTier(entry: ProfessionEntryDto): boolean {
    const [only, ...rest] = entry.tiers;
    return only !== undefined && rest.length === 0 && only.name === entry.name;
}
