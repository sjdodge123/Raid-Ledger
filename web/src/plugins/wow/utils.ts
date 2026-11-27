/**
 * Legacy WoW slug helpers (variant / namespace selection).
 *
 * ROK-1182: the slug → variant lookup tables (`SLUG_VARIANT_MAP`,
 * `FIXED_CLASSIC_VARIANTS`) now live in `./lib/wow-era.ts` alongside the
 * era lookup, derived from a single `WOW_SLUG_TABLE`. They are re-exported
 * here so existing consumers keep importing from `../utils` unchanged —
 * adding a new variant slug touches only `wow-era.ts`.
 */
import { SLUG_VARIANT_MAP, FIXED_CLASSIC_VARIANTS } from './lib/wow-era';

export { FIXED_CLASSIC_VARIANTS };

/** All recognized WoW game slugs (retail + all classic variants). */
export const WOW_SLUGS: ReadonlySet<string> = new Set(Object.keys(SLUG_VARIANT_MAP));

/** Check if a game slug belongs to any WoW game entry. */
export function isWowSlug(slug: string): boolean {
    return WOW_SLUGS.has(slug);
}

/**
 * Map game slug to WoW game variant for Blizzard API.
 * Returns null for non-WoW slugs.
 */
export function getWowVariant(slug: string): string | null {
    return SLUG_VARIANT_MAP[slug] ?? null;
}

/** ROK-2359: event-type → content category is core now; re-exported for WoW callers. */
export { getContentType } from '../../lib/event-content-type';
