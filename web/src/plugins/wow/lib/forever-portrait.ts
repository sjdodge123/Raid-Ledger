/**
 * ROK-1761: the fallback portrait for a WoW: Forever character. Forever has no
 * Blizzard character render and the LedgerLink addon cannot export images, so a
 * Forever character without an avatar shows a token tile: the class icon plus a
 * race initial badge (operator ruling 2026-10-10 — no generated per-race art).
 * ROK-1747: when the race AND gender map to a CDN race icon, the `race` kind
 * shows that icon with a class badge instead; the ROK-1761 tile is its fallback.
 *
 * Pure selection only; `components/forever-portrait.tsx` renders it.
 */
import type { WowVariant } from './wow-era';
import { getClassIconUrl } from './class-icons';
import { getRaceIconUrl } from './race-icons';

/** The ROK-1761 class tile kinds — also what a `race` portrait degrades to. */
export type ForeverClassTile =
    | { kind: 'tile'; classIconUrl: string; raceInitial: string; label: string }
    | { kind: 'class-only'; classIconUrl: string; label: string }
    | { kind: 'neutral'; label: string };

/** What a character's avatar slot shows. `none` = the surface's existing avatar. */
export type ForeverPortrait =
    | { kind: 'none' }
    | ForeverClassTile
    | { kind: 'race'; raceIconUrl: string; classIconUrl: string | null; fallback: ForeverClassTile; label: string };

export interface ForeverPortraitInput {
    /** From `resolveWowVariant` / `useCharacterWowVariant` — never the game slug alone. */
    variant: WowVariant | null;
    avatarUrl?: string | null | undefined;
    race?: string | null | undefined;
    gender?: string | null | undefined;
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

/** The ROK-1761 class tile: class icon + race initial, class icon alone, or the neutral glyph. */
function selectClassTile(race: string, classIconUrl: string | null, label: string): ForeverClassTile {
    if (!classIconUrl) return { kind: 'neutral', label };
    const raceInitial = raceInitials(race);
    if (!raceInitial) return { kind: 'class-only', classIconUrl, label };
    return { kind: 'tile', classIconUrl, raceInitial, label };
}

/** Picks the Forever fallback; non-Forever characters and any character with a render get `none`. */
export function selectForeverPortrait(input: ForeverPortraitInput): ForeverPortrait {
    if (input.variant !== 'wow_forever' || input.avatarUrl) return { kind: 'none' };
    const race = input.race?.trim() ?? '';
    const classIconUrl = getClassIconUrl(input.characterClass?.trim() ?? '');
    // Label = the character name, like every other character avatar (`alt={name}`).
    const label = input.name;
    const fallback = selectClassTile(race, classIconUrl, label);
    const raceIconUrl = getRaceIconUrl(race, input.gender);
    return raceIconUrl ? { kind: 'race', raceIconUrl, classIconUrl, fallback, label } : fallback;
}

/** Remount key: a changed image URL must reset the tile's load-error state. */
export function portraitKey(portrait: Exclude<ForeverPortrait, { kind: 'none' }>): string {
    if (portrait.kind === 'race') return `${portrait.raceIconUrl}|${portrait.classIconUrl ?? ''}`;
    return portrait.kind === 'neutral' ? '' : portrait.classIconUrl;
}
