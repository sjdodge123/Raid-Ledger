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

/**
 * Up to two initials for ANY race string — no allowlist, because the addon
 * import stores unknown race names verbatim (Skyborne). Splits on whitespace
 * and camelCase: "Night Elf" → "NE", "NightElf" → "NE", "Skyborne" → "S".
 */
export function raceInitials(race: string): string {
    return race
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase())
        .join('')
        .slice(0, 2);
}

/** Picks the Forever fallback; non-Forever characters and any character with a render get `none`. */
export function selectForeverPortrait(input: ForeverPortraitInput): ForeverPortrait {
    if (input.variant !== 'wow_forever' || input.avatarUrl) return { kind: 'none' };
    const race = input.race?.trim() ?? '';
    const cls = input.characterClass?.trim() ?? '';
    const classIconUrl = getClassIconUrl(cls);
    // Label = the character name, like every other character avatar (`alt={name}`).
    const label = input.name;
    if (!classIconUrl) return { kind: 'neutral', label };
    const raceInitial = raceInitials(race);
    if (!raceInitial) return { kind: 'class-only', classIconUrl, label };
    return { kind: 'tile', classIconUrl, raceInitial, label };
}
