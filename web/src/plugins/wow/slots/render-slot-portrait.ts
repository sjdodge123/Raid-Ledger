/**
 * ROK-1747: the Forever fallback portrait for the equipment render slot, shared
 * by the owned and (ROK-2149) read-only character sections. Kept out of
 * `character-detail-panels.tsx` so that file only exports components.
 */
import { selectForeverPortrait, type ForeverPortrait } from '../lib/forever-portrait';
import type { WowVariant } from '../lib/wow-era';

type PortraitCharacter = { race: string | null; gender?: string | null | undefined; class: string | null; name: string };

/** `renderUrl` stands in for the avatar so a Blizzard render always wins here. */
export function renderSlotPortrait(character: PortraitCharacter | undefined, variant: WowVariant | null, renderUrl: string | null): ForeverPortrait {
    if (!character) return { kind: 'none' };
    return selectForeverPortrait({
        variant, avatarUrl: renderUrl, race: character.race, gender: character.gender,
        characterClass: character.class, name: character.name,
    });
}
