/**
 * WoW profession max skill cap by era.
 *
 * Era is derived from the game slug via `getWowEra` so the lookup is
 * consistent with profession availability filtering.
 */

import type { WowEra } from './wow-era';
import { getWowEra } from './wow-era';

const MAX_BY_ERA: Record<WowEra, number> = {
    vanilla: 300,
    bc: 375,
    wrath: 450,
    cataclysm: 525,
    mop: 600,
    // Retail uses a per-expansion tier system where each expansion's
    // tier caps at 100. The parent profession aggregates higher in the
    // legacy API but the editable manual cap surfaces 100 by default.
    retail: 100,
};

/** Derive the max skill cap for a profession in the given game. */
export function getMaxProfessionSkill(gameSlug: string | null | undefined): number {
    return MAX_BY_ERA[getWowEra(gameSlug)];
}
