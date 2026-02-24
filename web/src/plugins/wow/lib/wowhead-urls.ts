/**
 * Shared Wowhead URL and tooltip helpers for the WoW plugin.
 *
 * Single source of truth for variant → domain mapping, used by:
 * - quest-prep-panel.tsx (quest/item links + tooltips)
 * - item-comparison.tsx (equipped item links + tooltips)
 * - character-detail-sections.tsx (equipment links + tooltips)
 */

/** Resolve a WoW game variant to the correct Wowhead domain segments. */
function getWowheadDomain(variant: string | null | undefined): { urlBase: string; tooltipDomain: string } {
    switch (variant) {
        case 'classic_anniversary':
            return { urlBase: 'www.wowhead.com/tbc', tooltipDomain: 'tbc' };
        case 'classic':
        case 'classic_era':
            return { urlBase: 'www.wowhead.com/classic', tooltipDomain: 'classic&dataEnv=1' };
        default:
            return { urlBase: 'www.wowhead.com', tooltipDomain: 'www' };
    }
}

/** Build a full Wowhead quest URL. */
export function getWowheadQuestUrl(questId: number, variant?: string | null): string {
    const { urlBase } = getWowheadDomain(variant);
    return `https://${urlBase}/quest=${questId}`;
}

/** Build a full Wowhead item URL. */
export function getWowheadItemUrl(itemId: number, variant?: string | null): string {
    const { urlBase } = getWowheadDomain(variant);
    return `https://${urlBase}/item=${itemId}`;
}

/** Build the data-wowhead tooltip attribute suffix (e.g. "domain=classic&dataEnv=1"). */
export function getWowheadDataSuffix(variant?: string | null): string {
    const { tooltipDomain } = getWowheadDomain(variant);
    return `domain=${tooltipDomain}`;
}

/** Build a complete data-wowhead attribute for an item (e.g. "item=12345&domain=classic&dataEnv=1"). */
export function getWowheadItemData(itemId: number, variant?: string | null): string {
    return `item=${itemId}&${getWowheadDataSuffix(variant)}`;
}

/** Build a complete data-wowhead attribute for a quest. */
export function getWowheadQuestData(questId: number, variant?: string | null): string {
    return `quest=${questId}&${getWowheadDataSuffix(variant)}`;
}

/** Build a Wowhead NPC search URL for a boss name. */
export function getWowheadNpcSearchUrl(bossName: string, variant?: string | null): string {
    const { urlBase } = getWowheadDomain(variant);
    return `https://${urlBase}/search?q=${encodeURIComponent(bossName)}`;
}

/**
 * Build a Wowhead talent calculator URL for a given class.
 * Maps the Blizzard API class name to the Wowhead URL slug, then builds the
 * appropriate talent-calc URL for the game variant.
 *
 * Returns null if the class name cannot be mapped.
 */
export function getWowheadTalentCalcUrl(
    className: string,
    variant?: string | null,
): string | null {
    const slug = wowClassToSlug(className);
    if (!slug) return null;
    const { urlBase } = getWowheadDomain(variant);
    return `https://${urlBase}/talent-calc/${slug}`;
}

/**
 * Build a Wowhead talent calculator embed URL for a specific Classic talent build.
 * The embed URL includes the talent string so Wowhead displays the exact build.
 *
 * Format: https://www.wowhead.com/classic/talent-calc/embed/{class}/{talent-string}
 *
 * Returns null if the class name cannot be mapped.
 */
export function getWowheadTalentCalcEmbedUrl(
    className: string,
    talentString: string,
    variant?: string | null,
): string | null {
    const slug = wowClassToSlug(className);
    if (!slug) return null;
    const { urlBase } = getWowheadDomain(variant);
    return `https://${urlBase}/talent-calc/embed/${slug}/${talentString}`;
}

/** Map a WoW class display name (from Blizzard API) to a Wowhead URL slug. */
function wowClassToSlug(className: string): string | null {
    const map: Record<string, string> = {
        'death knight': 'death-knight',
        'demon hunter': 'demon-hunter',
        druid: 'druid',
        evoker: 'evoker',
        hunter: 'hunter',
        mage: 'mage',
        monk: 'monk',
        paladin: 'paladin',
        priest: 'priest',
        rogue: 'rogue',
        shaman: 'shaman',
        warlock: 'warlock',
        warrior: 'warrior',
    };
    return map[className.toLowerCase()] ?? null;
}
