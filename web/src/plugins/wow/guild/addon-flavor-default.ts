/**
 * ROK-2114 — the flavor a guild's "Recommended mods" panel opens on. A
 * WoW: Forever guild should land on Forever (filter and Add form) instead of
 * All / Any flavor; every other segment stays selectable.
 *
 * Derived from the hub's game slug (`GuildSummary.gameSlug`, ROK-1906) — the
 * only flavor signal the guild page carries client-side. An unknown or
 * ambiguous slug answers `null`, which keeps today's All / Any flavor.
 */
import type { GuildAddonFlavor } from '@raid-ledger/contract';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';

const RETAIL_SLUG = 'world-of-warcraft';
const WOW_PREFIX = 'world-of-warcraft-';
/** Classic-era slugs whose name lacks "classic" (migration 0091 uses this one for Wrath Classic). */
const CLASSIC_SLUGS: ReadonlySet<string> = new Set(['world-of-warcraft-wrath-of-the-lich-king']);

/** The addon flavor a hub's game slug implies, or `null` when it is unknown or ambiguous. */
export function guildAddonFlavorForSlug(slug: string | null | undefined): GuildAddonFlavor | null {
    if (!slug) return null;
    if (slug === WOW_FOREVER_GAME_SLUG) return 'forever';
    if (slug === RETAIL_SLUG) return 'retail';
    if (CLASSIC_SLUGS.has(slug)) return 'classic';
    if (slug.startsWith(WOW_PREFIX) && slug.split('-').includes('classic')) return 'classic';
    return null;
}

/**
 * The value a flavor control shows: the user's own pick when they made one
 * (`undefined` = untouched, so a guild flavor that loads late never clobbers
 * it), else the guild's flavor, else the control's old default.
 */
export function pickFlavor<T>(choice: T | undefined, derived: T | null, fallback: T): T {
    if (choice !== undefined) return choice;
    return derived ?? fallback;
}
