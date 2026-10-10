/**
 * ROK-1761: the fallback portrait for a WoW: Forever character. Forever has no
 * Blizzard character render and the LedgerLink addon cannot export images, so a
 * Forever character without an avatar shows a token tile: the class icon plus a
 * race initial badge (operator ruling 2026-10-10 — no generated per-race art).
 *
 * Pure selection only; `components/forever-portrait.tsx` renders it.
 */
import type { WowVariant } from './wow-era';
import { getClassIconUrl } from './class-icons';

/**
 * Races the tile labels. A race outside this list (a new Forever race such as
 * Skyborne) degrades to the class icon alone rather than guessing a label.
 */
export const WOW_KNOWN_RACES: ReadonlySet<string> = new Set([
    'Human', 'Dwarf', 'Night Elf', 'Gnome', 'Draenei', 'Worgen', 'Pandaren',
    'Orc', 'Undead', 'Tauren', 'Troll', 'Blood Elf', 'Goblin',
    'Void Elf', 'Lightforged Draenei', 'Dark Iron Dwarf', 'Kul Tiran', 'Mechagnome',
    'Nightborne', 'Highmountain Tauren', "Mag'har Orc", 'Zandalari Troll', 'Vulpera',
    'Dracthyr', 'Earthen',
]);

/** What a character's avatar slot shows. `none` = the surface's existing avatar. */
export type ForeverPortrait =
    | { kind: 'none' }
    | { kind: 'tile'; classIconUrl: string; raceInitial: string; label: string }
    | { kind: 'class-only'; classIconUrl: string; label: string }
    | { kind: 'neutral'; label: string };

export interface ForeverPortraitInput {
    /** From `resolveWowVariant` / `useCharacterWowVariant` — never the game slug alone. */
    variant: WowVariant | null;
    avatarUrl?: string | null | undefined;
    race?: string | null | undefined;
    characterClass?: string | null | undefined;
    name: string;
}

/** "Night Elf" → "NE", "Human" → "H". */
export function raceInitials(race: string): string {
    return race.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase()).join('').slice(0, 2);
}

/** Picks the Forever fallback; non-Forever characters and any character with a render get `none`. */
export function selectForeverPortrait(input: ForeverPortraitInput): ForeverPortrait {
    if (input.variant !== 'wow_forever' || input.avatarUrl) return { kind: 'none' };
    const race = input.race?.trim() ?? '';
    const cls = input.characterClass?.trim() ?? '';
    const classIconUrl = getClassIconUrl(cls);
    if (!classIconUrl) return { kind: 'neutral', label: input.name };
    if (!WOW_KNOWN_RACES.has(race)) return { kind: 'class-only', classIconUrl, label: cls };
    return { kind: 'tile', classIconUrl, raceInitial: raceInitials(race), label: `${race} ${cls}` };
}
