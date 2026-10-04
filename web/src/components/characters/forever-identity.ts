/**
 * WoW: Forever identity (ROK-1721): realmless — a character is a region plus
 * a two-part "First Second" name, and plays on a ruleset. These helpers keep
 * the three manual add surfaces (profile modal, inline signup form,
 * onboarding step) building the same state, errors and request fields.
 */
import {
    WowForeverNamePartSchema, WOW_FOREVER_DEFAULT_REGION, WOW_FOREVER_RULESET_LABELS,
    WowForeverRulesetSchema, WowRegionSchema,
    type WowForeverRuleset, type WowForeverSelectableRuleset, type WowRegion,
} from '@raid-ledger/contract';

/** Forever is detected by its game slug, never by `game_variant`. */
export const WOW_FOREVER_GAME_SLUG = 'world-of-warcraft-forever';

export function isWowForeverSlug(slug: string | null | undefined): boolean {
    return slug === WOW_FOREVER_GAME_SLUG;
}

/**
 * Whether a form shows the Forever identity block. A Forever-game character
 * saved before regions existed (region NULL) has no Forever identity, so its
 * edit form keeps the legacy Name + Realm fields and never sends a ruleset.
 */
export function usesForeverIdentity(slug: string | null | undefined, editing?: { region?: string | null } | null): boolean {
    return isWowForeverSlug(slug) && (!editing || !!editing.region);
}

export interface ForeverIdentity {
    region: WowRegion;
    /** Hardcore is stored-capable but not pickable; an existing Hardcore value is kept as-is. */
    ruleset: WowForeverRuleset;
    first: string;
    second: string;
}

export interface ForeverIdentityErrors { first?: string; second?: string; name?: string }

export const FOREVER_NAME_REQUIRED = 'Enter a first and second name';
export const FOREVER_PART_INVALID = 'Letters only, 2–24';

export function emptyForeverIdentity(): ForeverIdentity {
    return { region: WOW_FOREVER_DEFAULT_REGION, ruleset: 'normal', first: '', second: '' };
}

/** Edit mode: split the stored "First Second" name back into its parts. */
export function foreverIdentityFromCharacter(char: { name: string; region?: string | null; ruleset?: string | null } | null | undefined): ForeverIdentity {
    if (!char) return emptyForeverIdentity();
    const [first = '', ...rest] = char.name.trim().split(/\s+/);
    const region = WowRegionSchema.safeParse(char.region);
    const ruleset = WowForeverRulesetSchema.safeParse(char.ruleset);
    return {
        region: region.success ? region.data : WOW_FOREVER_DEFAULT_REGION,
        ruleset: ruleset.success ? ruleset.data : 'normal',
        first, second: rest.join(' '),
    };
}

/** Value equality — the dirty check must not flag a new object holding the same identity. */
export function sameForeverIdentity(a: ForeverIdentity, b: ForeverIdentity): boolean {
    return a.region === b.region && a.ruleset === b.ruleset && a.first === b.first && a.second === b.second;
}

/** Null when valid; otherwise the inline messages for the name row. */
export function validateForeverIdentity(id: ForeverIdentity): ForeverIdentityErrors | null {
    if (!id.first.trim() || !id.second.trim()) return { name: FOREVER_NAME_REQUIRED };
    const errs: ForeverIdentityErrors = {};
    if (!WowForeverNamePartSchema.safeParse(id.first).success) errs.first = FOREVER_PART_INVALID;
    if (!WowForeverNamePartSchema.safeParse(id.second).success) errs.second = FOREVER_PART_INVALID;
    return errs.first || errs.second ? errs : null;
}

export function foreverFullName(id: ForeverIdentity): string {
    return `${id.first.trim()} ${id.second.trim()}`;
}

/** The ruleset as a request value: Hardcore is not accepted on writes, so it is left off. */
function writableRuleset(r: WowForeverRuleset): WowForeverSelectableRuleset | undefined {
    return r === 'hardcore' ? undefined : r;
}

/** Create request fields: full name + region + ruleset, and never a realm. */
export function foreverCreateFields(id: ForeverIdentity) {
    const ruleset = writableRuleset(id.ruleset);
    return { name: foreverFullName(id), region: id.region, ...(ruleset ? { ruleset } : {}) };
}

/** Update request fields: region is locked after creation, so it is never sent. */
export function foreverUpdateFields(id: ForeverIdentity) {
    const ruleset = writableRuleset(id.ruleset);
    return { name: foreverFullName(id), ...(ruleset ? { ruleset } : {}) };
}

/** "PvP (US)" — the ruleset label shown where a realm would be; null for non-Forever characters. */
export function formatForeverRuleset(ruleset: string | null | undefined, region: string | null | undefined): string | null {
    const parsed = WowForeverRulesetSchema.safeParse(ruleset);
    if (!parsed.success) return null;
    const label = WOW_FOREVER_RULESET_LABELS[parsed.data];
    return region ? `${label} (${region.toUpperCase()})` : label;
}
