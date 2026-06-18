/**
 * Single source of truth for WoW slug → variant/era lookups (ROK-1182).
 *
 * Decision: Option B — co-locate the two slug-keyed lookup tables that
 * previously lived here (`ERA_BY_SLUG`) and in `../utils.ts`
 * (`SLUG_VARIANT_MAP`). They key on overlapping-but-distinct slug sets and
 * carry independent value spaces (a `WowEra` enum vs a legacy variant
 * string), and there is no 1:1 era↔variant function — era `bc` covers both
 * the `classic` and `classic_anniversary` variants — so neither could be
 * derived from the other (rules out Options A/C) without changing behavior.
 *
 * Instead, every recognized slug declares BOTH facets in `WOW_SLUG_TABLE`
 * below. `ERA_BY_SLUG` and the variant maps in `../utils.ts` are derived
 * from it, so adding a new variant slug touches ONLY this file.
 *
 * Era derivation feeds max-skill + profession-availability; anything we
 * don't recognise falls back to `retail` since most modern variants share
 * the live WoW Profile API namespace and the same caps.
 */

export type WowEra =
    | 'vanilla'
    | 'bc'
    | 'wrath'
    | 'cataclysm'
    | 'mop'
    | 'retail';

/** Legacy variant string used for Blizzard API namespace selection. */
export type WowVariant = 'retail' | 'classic_era' | 'classic_anniversary' | 'classic';

interface WowSlugEntry {
    /** WoW era — drives profession availability + max-skill caps. */
    era?: WowEra;
    /** Legacy variant string for namespace selection (older flows). */
    variant?: WowVariant;
    /**
     * True for Classic variants that have a fixed variant (no selector
     * needed). Excludes plain `world-of-warcraft-classic`, which is
     * selectable.
     */
    fixedClassic?: boolean;
}

/**
 * The single slug-keyed table both lookups are derived from. Each entry
 * declares whichever facets that slug participates in — `era` for the
 * profession/max-skill flows, `variant` for legacy namespace selection.
 */
const WOW_SLUG_TABLE: Record<string, WowSlugEntry> = {
    'world-of-warcraft': { variant: 'retail' },
    'world-of-warcraft-classic': { variant: 'classic_era', era: 'vanilla' },
    'world-of-warcraft-classic-season-of-discovery': { era: 'vanilla' },
    'world-of-warcraft-burning-crusade-classic': {
        variant: 'classic',
        era: 'bc',
        fixedClassic: true,
    },
    'world-of-warcraft-burning-crusade-classic-anniversary-edition': {
        variant: 'classic_anniversary',
        era: 'bc',
        fixedClassic: true,
    },
    'world-of-warcraft-wrath-of-the-lich-king': {
        variant: 'classic',
        fixedClassic: true,
    },
    'world-of-warcraft-wrath-of-the-lich-king-classic': { era: 'wrath' },
    'world-of-warcraft-cataclysm-classic': { era: 'cataclysm' },
    'world-of-warcraft-mists-of-pandaria-classic': { era: 'mop' },
};

function deriveEraBySlug(): Record<string, WowEra> {
    const out: Record<string, WowEra> = {};
    for (const [slug, entry] of Object.entries(WOW_SLUG_TABLE)) {
        if (entry.era) out[slug] = entry.era;
    }
    return out;
}

function deriveVariantBySlug(): Record<string, WowVariant> {
    const out: Record<string, WowVariant> = {};
    for (const [slug, entry] of Object.entries(WOW_SLUG_TABLE)) {
        if (entry.variant) out[slug] = entry.variant;
    }
    return out;
}

function deriveFixedClassicVariants(): Record<string, WowVariant> {
    const out: Record<string, WowVariant> = {};
    for (const [slug, entry] of Object.entries(WOW_SLUG_TABLE)) {
        if (entry.fixedClassic && entry.variant) out[slug] = entry.variant;
    }
    return out;
}

const ERA_BY_SLUG: Record<string, WowEra> = deriveEraBySlug();

/** Slug → legacy variant string for all WoW game entries (derived). */
export const SLUG_VARIANT_MAP: Readonly<Record<string, WowVariant>> = deriveVariantBySlug();

/** Classic variant game slugs that have a fixed variant (no selector). */
export const FIXED_CLASSIC_VARIANTS: Readonly<Record<string, WowVariant>> =
    deriveFixedClassicVariants();

/** Derive the WoW era for a game slug, defaulting to `retail`. */
export function getWowEra(gameSlug: string | null | undefined): WowEra {
    if (!gameSlug) return 'retail';
    return ERA_BY_SLUG[gameSlug] ?? 'retail';
}
