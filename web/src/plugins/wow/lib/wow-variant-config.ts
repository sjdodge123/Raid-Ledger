/**
 * ROK-1726: the ONE variant-keyed table every WoW integration switch derives
 * from (Wowhead domain, card label, talent calculator, Armory import).
 *
 * Adding a variant to `WowVariant` (wow-era.ts) without a row here is a
 * compile error, and `wow-variant-config.test.ts` also pins the keys against
 * the contract's `WowGameVariantSchema`.
 *
 * Operator ruling 2026-10-04: Wowhead's Forever environment (`/forever`,
 * `domain=forever`) applies ONLY to WoW: Forever. Every other row's Wowhead
 * values are copied verbatim from the pre-ROK-1726 switch — including the
 * `classic&dataEnv=1` tooltip suffix — and pinned by wowhead-urls.test.ts.
 */
import type { WowVariant } from './wow-era';

export interface WowheadDomain {
    urlBase: string;
    tooltipDomain: string;
}

export interface WowVariantIntegrations {
    /** Short card badge; retail has none. */
    label: string | null;
    wowhead: WowheadDomain;
    talentCalc: 'classic3tree' | 'retailTraits' | 'foreverTraits';
    /** Whether the Blizzard Armory can import this variant (ROK-1717 makes it runtime). */
    armoryImport: boolean;
    /** apiNamespacePrefix forms accepted wherever a variant is. */
    namespaceAliases: readonly string[];
}

const RETAIL_WOWHEAD: WowheadDomain = { urlBase: 'www.wowhead.com', tooltipDomain: 'www' };
const CLASSIC_WOWHEAD: WowheadDomain = { urlBase: 'www.wowhead.com/classic', tooltipDomain: 'classic&dataEnv=1' };
const FOREVER_WOWHEAD: WowheadDomain = { urlBase: 'www.wowhead.com/forever', tooltipDomain: 'forever' };

export const WOW_VARIANT_INTEGRATIONS: Readonly<Record<WowVariant, WowVariantIntegrations>> = {
    retail: { label: null, wowhead: RETAIL_WOWHEAD, talentCalc: 'retailTraits', armoryImport: true, namespaceAliases: [] },
    classic_era: { label: 'Era', wowhead: CLASSIC_WOWHEAD, talentCalc: 'classic3tree', armoryImport: true, namespaceAliases: ['classic1x'] },
    // The 'classic' namespace prefix equals this key, so it needs no alias.
    classic: { label: 'Cata', wowhead: CLASSIC_WOWHEAD, talentCalc: 'classic3tree', armoryImport: true, namespaceAliases: [] },
    classic_anniversary: {
        label: 'TBC',
        wowhead: { urlBase: 'www.wowhead.com/tbc', tooltipDomain: 'tbc' },
        talentCalc: 'classic3tree',
        armoryImport: true,
        namespaceAliases: ['classicann'],
    },
    wow_forever: { label: 'Forever', wowhead: FOREVER_WOWHEAD, talentCalc: 'foreverTraits', armoryImport: false, namespaceAliases: ['classicforever'] },
};

/** The retail Wowhead domain — the fallback for any unrecognised variant or expansion. */
export const WOWHEAD_RETAIL_DOMAIN: WowheadDomain = RETAIL_WOWHEAD;

/**
 * Loot-item expansion key → Wowhead domain (boss loot panels). `forever` is
 * web-only until ROK-1719 adds it to the contract's expansion enum (D4).
 */
export const WOWHEAD_EXPANSION_DOMAINS: Readonly<Record<string, WowheadDomain>> = {
    tbc: { urlBase: 'www.wowhead.com/tbc', tooltipDomain: 'tbc' },
    wotlk: { urlBase: 'www.wowhead.com/wotlk', tooltipDomain: 'wotlk' },
    cata: { urlBase: 'www.wowhead.com/cata', tooltipDomain: 'cata' },
    sod: CLASSIC_WOWHEAD,
    classic: CLASSIC_WOWHEAD,
    forever: FOREVER_WOWHEAD,
};

const VARIANT_BY_KEY_OR_ALIAS: ReadonlyMap<string, WowVariant> = new Map(
    (Object.entries(WOW_VARIANT_INTEGRATIONS) as [WowVariant, WowVariantIntegrations][]).flatMap(
        ([key, row]) => [key, ...row.namespaceAliases].map((name) => [name, key] as const),
    ),
);

/** A variant key or apiNamespacePrefix alias → its variant key; anything else → null. */
export function normalizeWowVariant(variant: string | null | undefined): WowVariant | null {
    return variant ? (VARIANT_BY_KEY_OR_ALIAS.get(variant) ?? null) : null;
}

/** The integrations row for a variant key or alias; null when unrecognised. */
export function getWowVariantIntegrations(variant: string | null | undefined): WowVariantIntegrations | null {
    const key = normalizeWowVariant(variant);
    return key ? WOW_VARIANT_INTEGRATIONS[key] : null;
}

/**
 * The effective variant of a character (D6). Manual WoW: Forever characters
 * (ROK-1721) are stored with `gameVariant: null` and a `ruleset`, so a
 * ruleset with no recognised variant means Forever.
 */
export function resolveWowVariant(character: { gameVariant?: string | null | undefined; ruleset?: string | null | undefined }): WowVariant | null {
    const variant = normalizeWowVariant(character.gameVariant);
    if (variant) return variant;
    return character.ruleset != null ? 'wow_forever' : null;
}

/** Short card badge for a variant; null for retail and unknown variants. */
export function getWowVariantLabel(variant: string | null | undefined): string | null {
    return getWowVariantIntegrations(variant)?.label ?? null;
}

/** Empty-state hint for a WoW: Forever character with no equipment (operator-approved copy, OQ2). */
export const FOREVER_ADDON_HINT_EQUIPMENT =
    "WoW: Forever gear isn't on the Blizzard Armory yet. It will appear here once you import it with the Raid Ledger addon.";

/** Empty-state hint for a WoW: Forever character with no talents. */
export const FOREVER_ADDON_HINT_TALENTS =
    "WoW: Forever talents aren't on the Blizzard Armory yet. They will appear here once you import them with the Raid Ledger addon.";

/**
 * Map an event's game slug to the variant the boss/loot and quest APIs take.
 * Handles both short legacy slugs and full ITAD-style variant slugs; falls
 * back to classic_era for unknown slugs. Moved verbatim from
 * boss-loot-panel.tsx / quest-prep-panel.tsx (OQ4).
 */
export function slugToContentVariant(gameSlug?: string): string {
    switch (gameSlug) {
        case 'wow-classic-anniversary':
        case 'world-of-warcraft-burning-crusade-classic-anniversary-edition':
            return 'classic_anniversary';
        case 'world-of-warcraft-classic':
        case 'wow-classic-era':
            return 'classic_era';
        case 'wow-classic':
        case 'wow-cata':
        case 'world-of-warcraft-burning-crusade-classic':
        case 'world-of-warcraft-wrath-of-the-lich-king':
            return 'classic';
        case 'wow-retail':
        case 'world-of-warcraft':
            return 'retail';
        // ROK-1563: WoW: Forever — vanilla content only for now.
        case 'world-of-warcraft-forever':
            return 'wow_forever';
        default:
            return 'classic_era';
    }
}
