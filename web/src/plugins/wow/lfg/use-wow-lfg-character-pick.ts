/**
 * ROK-2352 §3.3 / §4.1 — the optional character on a WoW hand: the caller's
 * characters on this game that fit its variant (the API's `wowCharacterFitsSlug`
 * rule: Forever characters only on the Forever game), seeded from the last
 * hand's `characterId`. A seed that no longer fits is dropped, so the hand
 * never carries a character the API would refuse.
 */
import { useState } from 'react';
import type { CharacterDto } from '@raid-ledger/contract';
import { useMyCharacters } from '../../../hooks/use-characters';
import { resolveWowVariant, slugToContentVariant } from '../lib/wow-variant-config';
import { useWowLfgLastDetail } from './use-wow-lfg-last-detail';

/** True when the character may go on a hand for the game `gameSlug`. */
export function wowLfgCharacterFits(c: Pick<CharacterDto, 'gameVariant' | 'ruleset'>, gameSlug: string): boolean {
    const forever = resolveWowVariant({ gameVariant: c.gameVariant, ruleset: c.ruleset }) === 'wow_forever';
    if (slugToContentVariant(gameSlug) !== 'wow_forever') return !forever;
    return forever || c.gameVariant === null;
}

export interface WowLfgCharacterPick {
    options: readonly CharacterDto[];
    /** The picked character id; null = none. Always one of `options`. */
    characterId: string | null;
    setCharacterId: (id: string | null) => void;
}

/** The character options and pick for a hand on `gameId`. */
export function useWowLfgCharacterPick(gameId: number, gameSlug: string): WowLfgCharacterPick {
    const chars = useMyCharacters(gameId);
    const last = useWowLfgLastDetail(gameId);
    const [picked, setPicked] = useState<string | null | undefined>(undefined);
    const options = (chars.data?.data ?? []).filter((c) => wowLfgCharacterFits(c, gameSlug));
    const wanted = picked === undefined ? (last.data?.characterId ?? null) : picked;
    const characterId = wanted !== null && options.some((c) => c.id === wanted) ? wanted : null;
    return { options, characterId, setCharacterId: setPicked };
}
