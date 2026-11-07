import type { ProfessionEntryDto, ProfessionTierDto } from '@raid-ledger/contract';

/** The skill pair a profession header or badge shows. */
export interface ProfessionSkill {
    skillLevel: number;
    maxSkillLevel: number;
}

/**
 * The tier with the highest max skill (the single tier when there is one).
 * Deliberate: on retail a multi-expansion entry headlines its highest-cap
 * tier (often Classic 300/300); the tier list still shows each expansion.
 * Mirrors `headlineTier` in api `blizzard-professions.helpers.ts` — keep both
 * in step.
 */
function headlineTier(tiers: ProfessionTierDto[]): ProfessionTierDto | undefined {
    return tiers.reduce<ProfessionTierDto | undefined>(
        (best, t) => (best === undefined || t.maxSkillLevel > best.maxSkillLevel ? t : best),
        undefined,
    );
}

/**
 * Header skill for a profession entry. Armory rows stored before the API
 * mapper read skill from `tiers[]` carry a 0/0 header, so a 0/0 header falls
 * back to the headline tier's pair until the next sync rewrites the row
 * (FOREVER-CHARPANEL-AUDIT §3). Any other header is explicit and kept as is —
 * the two sources are never mixed.
 */
export function effectiveProfessionSkill(entry: ProfessionEntryDto): ProfessionSkill {
    const header = { skillLevel: entry.skillLevel, maxSkillLevel: entry.maxSkillLevel };
    if (header.skillLevel !== 0 || header.maxSkillLevel !== 0) return header;
    const tier = headlineTier(entry.tiers);
    return tier ? { skillLevel: tier.skillLevel, maxSkillLevel: tier.maxSkillLevel } : header;
}

const normName = (name: string): string => name.trim().toLowerCase();

/** True when the only tier just repeats the profession (Forever: "Mining" under "Mining"). */
export function hasOnlyRedundantTier(entry: ProfessionEntryDto): boolean {
    const [only, ...rest] = entry.tiers;
    return only !== undefined && rest.length === 0 && normName(only.name) === normName(entry.name);
}
