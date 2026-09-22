/**
 * ROK-1636: which WoW variants the Blizzard Armory can import from.
 *
 * Blizzard has no WoW: Forever profile API yet (the namespace answers 403), so
 * both Armory entry points (the Add Character tabs and the inline import) ask
 * this one helper. When ROK-1562 lands the real namespace, drop `wow_forever`
 * from the set and every entry point — tabs and variant pickers — comes back.
 */
import { WOW_FOREVER_LABEL } from './wow-era';

const ARMORY_UNSUPPORTED_VARIANTS: ReadonlySet<string> = new Set(['wow_forever']);

/** Short muted note shown wherever the Armory tab is unavailable. */
export const ARMORY_UNAVAILABLE_NOTE =
    "Armory import isn't available for WoW Forever yet — add the character manually.";

/** True when the Armory can import characters for this variant. Unknown/absent = retail = supported. */
export function isArmoryImportSupported(variant: string | null | undefined): boolean {
    return !variant || !ARMORY_UNSUPPORTED_VARIANTS.has(variant);
}

const ALL_CLASSIC_VARIANTS = [
    { value: 'classic_anniversary', label: 'Classic Anniversary (TBC)' },
    { value: 'classic_era', label: 'Classic Era / SoD' },
    { value: 'classic', label: 'Classic (Cata)' },
    { value: 'wow_forever', label: WOW_FOREVER_LABEL },
] as const;

/** Classic variants the Armory "Game Version" pickers offer — only the importable ones. */
export const ARMORY_CLASSIC_VARIANTS = ALL_CLASSIC_VARIANTS.filter((v) => isArmoryImportSupported(v.value));
