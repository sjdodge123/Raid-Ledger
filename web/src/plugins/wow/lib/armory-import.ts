/**
 * ROK-1636: which WoW variants the Blizzard Armory can import from.
 *
 * Blizzard has no WoW: Forever profile API yet (the namespace answers 403), so
 * both Armory entry points (the Add Character tabs and the inline import) ask
 * this one helper. The static default lives in wow-variant-config.ts
 * (ROK-1726); ROK-1717 layers the admin-set runtime capability
 * (`GET /blizzard/capabilities`) on top, so turning Forever Armory import on
 * needs no deploy. Fails CLOSED (D6): while the capability is loading or the
 * call failed (`caps` undefined), Forever stays unsupported.
 */
import type { BlizzardCapabilitiesDto } from '@raid-ledger/contract';
import { WOW_FOREVER_LABEL } from './wow-era';
import { getWowVariantIntegrations, normalizeWowVariant } from './wow-variant-config';

/** The runtime Armory capabilities; undefined/null while loading or after a failed fetch. */
export type ArmoryCapabilities = BlizzardCapabilitiesDto | null | undefined;

/** Short muted note shown wherever the Armory tab is unavailable. */
export const ARMORY_UNAVAILABLE_NOTE =
    "Armory import isn't available for WoW Forever yet — add the character manually.";

/**
 * True when the Armory can import characters for this variant. Unknown/absent = retail = supported.
 * A variant the static table marks unsupported is supported only when the runtime capability says so.
 */
export function isArmoryImportSupported(variant: string | null | undefined, caps: ArmoryCapabilities): boolean {
    if (!variant || (getWowVariantIntegrations(variant)?.armoryImport ?? true)) return true;
    return normalizeWowVariant(variant) === 'wow_forever' && caps?.armoryImport.wow_forever === true;
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
