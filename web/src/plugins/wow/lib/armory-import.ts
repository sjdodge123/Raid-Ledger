/**
 * Which WoW variants the Blizzard Armory can import from.
 *
 * Both Armory entry points (the Add Character tabs and the inline import) ask
 * this one helper. The static default lives in wow-variant-config.ts
 * (ROK-1726). WoW: Forever is supported through the realmless profile route
 * (ROK-1722) unless the admin switches it off: the runtime capability
 * (`GET /blizzard/capabilities`, ROK-1717) is the kill switch. Fails CLOSED
 * (D6): while the capability is loading or the call failed (`caps`
 * undefined), Forever stays unsupported.
 */
import type { BlizzardCapabilitiesDto } from '@raid-ledger/contract';
import { WOW_FOREVER_LABEL } from './wow-era';
import { getWowVariantIntegrations, normalizeWowVariant } from './wow-variant-config';

/** The runtime Armory capabilities; undefined/null while loading or after a failed fetch. */
export type ArmoryCapabilities = BlizzardCapabilitiesDto | null | undefined;

/** Short muted note shown wherever the Armory tab is unavailable. */
export const ARMORY_UNAVAILABLE_NOTE =
    'Armory import for WoW Forever is turned off on this server — add the character manually.';

/**
 * True when the Armory can import characters for this variant. Unknown/absent = retail = supported.
 * WoW: Forever also needs the runtime capability on: an admin's `false` is the kill switch, and a
 * capability still loading (or failed) fails closed.
 */
export function isArmoryImportSupported(variant: string | null | undefined, caps: ArmoryCapabilities): boolean {
    if (!variant) return true;
    const staticOn = getWowVariantIntegrations(variant)?.armoryImport ?? true;
    if (normalizeWowVariant(variant) !== 'wow_forever') return staticOn;
    return staticOn && caps?.armoryImport.wow_forever === true;
}

const ALL_CLASSIC_VARIANTS = [
    { value: 'classic_anniversary', label: 'Classic Anniversary (TBC)' },
    { value: 'classic_era', label: 'Classic Era / SoD' },
    { value: 'classic', label: 'Classic (Cata)' },
    { value: 'wow_forever', label: WOW_FOREVER_LABEL },
] as const;

type ClassicVariantOption = (typeof ALL_CLASSIC_VARIANTS)[number];

/** Classic variants the Armory "Game Version" pickers offer — only the importable ones for these caps. */
export function armoryClassicVariants(caps: ArmoryCapabilities): ClassicVariantOption[] {
    return ALL_CLASSIC_VARIANTS.filter((v) => isArmoryImportSupported(v.value, caps));
}

/**
 * Default Classic variant for an Armory picker whose game does not fix one.
 * An event's context variant is the dominant variant of its signed-up
 * characters, so it can be `wow_forever` even on the Classic game. That must
 * not lock the Armory tab (the picker lives inside it), so an unsupported
 * context variant falls back to the first importable one.
 */
export function defaultArmoryClassicVariant(contextVariant: string | null | undefined, caps: ArmoryCapabilities): string {
    if (contextVariant && isArmoryImportSupported(contextVariant, caps)) return contextVariant;
    return (armoryClassicVariants(caps)[0] ?? ALL_CLASSIC_VARIANTS[0]).value;
}
