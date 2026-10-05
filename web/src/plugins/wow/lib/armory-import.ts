/**
 * ROK-1636: which WoW variants the Blizzard Armory can import from.
 *
 * Blizzard has no WoW: Forever profile API yet (the namespace answers 403), so
 * both Armory entry points (the Add Character tabs and the inline import) ask
 * this one helper. The flag lives in wow-variant-config.ts (ROK-1726): when
 * ROK-1562 lands the real namespace, flip `wow_forever.armoryImport` and every
 * entry point — tabs and variant pickers — comes back.
 */
import { WOW_FOREVER_LABEL } from './wow-era';
import { getWowVariantIntegrations } from './wow-variant-config';

/** Short muted note shown wherever the Armory tab is unavailable. */
export const ARMORY_UNAVAILABLE_NOTE =
    "Armory import isn't available for WoW Forever yet — add the character manually.";

/** True when the Armory can import characters for this variant. Unknown/absent = retail = supported. */
export function isArmoryImportSupported(variant: string | null | undefined): boolean {
    return !variant || (getWowVariantIntegrations(variant)?.armoryImport ?? true);
}

const ALL_CLASSIC_VARIANTS = [
    { value: 'classic_anniversary', label: 'Classic Anniversary (TBC)' },
    { value: 'classic_era', label: 'Classic Era / SoD' },
    { value: 'classic', label: 'Classic (Cata)' },
    { value: 'wow_forever', label: WOW_FOREVER_LABEL },
] as const;

/** Classic variants the Armory "Game Version" pickers offer — only the importable ones. */
export const ARMORY_CLASSIC_VARIANTS = ALL_CLASSIC_VARIANTS.filter((v) => isArmoryImportSupported(v.value));

/**
 * Default Classic variant for an Armory picker whose game does not fix one.
 * An event's context variant is the dominant variant of its signed-up
 * characters, so it can be `wow_forever` even on the Classic game. That must
 * not lock the Armory tab (the picker lives inside it), so an unsupported
 * context variant falls back to the first importable one.
 */
export function defaultArmoryClassicVariant(contextVariant: string | null | undefined): string {
    return contextVariant && isArmoryImportSupported(contextVariant) ? contextVariant : (ARMORY_CLASSIC_VARIANTS[0] ?? ALL_CLASSIC_VARIANTS[0]).value;
}
