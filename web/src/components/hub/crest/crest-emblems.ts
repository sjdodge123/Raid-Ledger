/**
 * ROK-1814 — preset crest emblem art, keyed by the contract's emblem id.
 *
 * PLACEHOLDER: every id draws the same heraldic shield until the curated
 * game-icons.net art (CC BY 3.0, authors in `GUILD_CREST_EMBLEM_CREDITS`)
 * lands with the picker. Swapping the art means filling `viewBox` + `paths`
 * per id here; `HubCrest` renders whatever this map holds.
 */
import type { GuildCrestEmblemId } from '@raid-ledger/contract';

/** One emblem's SVG: a viewBox and the path data, each path filled with `currentColor`. */
export interface CrestEmblemArt {
    viewBox: string;
    paths: readonly string[];
}

const PLACEHOLDER: CrestEmblemArt = {
    viewBox: '0 0 64 64',
    paths: ['M32 10l18 6v13c0 12-7.5 19.5-18 22.5C21.5 48.5 14 41 14 29V16z'],
};

/** Emblem id → art. A full Record, so a new contract id fails the build until it has art. */
export const CREST_EMBLEMS: Record<GuildCrestEmblemId, CrestEmblemArt> = {
    'checked-shield': PLACEHOLDER,
    'crossed-swords': PLACEHOLDER,
    'dragon-head': PLACEHOLDER,
    'wolf-head': PLACEHOLDER,
    'death-skull': PLACEHOLDER,
    'oak': PLACEHOLDER,
    'crown': PLACEHOLDER,
    'battle-axe': PLACEHOLDER,
    'eagle-emblem': PLACEHOLDER,
    'griffin-symbol': PLACEHOLDER,
    'fleur-de-lys': PLACEHOLDER,
    'flame': PLACEHOLDER,
    'anvil': PLACEHOLDER,
    'castle': PLACEHOLDER,
    'lion': PLACEHOLDER,
    'bear-head': PLACEHOLDER,
};
