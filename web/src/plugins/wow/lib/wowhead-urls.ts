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
