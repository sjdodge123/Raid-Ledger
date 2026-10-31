/**
 * ROK-1814 — preset crest emblem art, keyed by the contract's emblem id.
 *
 * The art is curated game-icons.net icons (CC BY 3.0), path data copied into
 * `crest-emblem-art-a.ts` / `crest-emblem-art-b.ts` as static strings — never
 * fetched at runtime. Authors live in `GUILD_CREST_EMBLEM_CREDITS` (credit line
 * under the picker) and `docs/credits/game-icons.md`. `HubCrest` renders
 * whatever this map holds.
 */
import type { GuildCrestEmblemId } from '@raid-ledger/contract';
import { CREST_EMBLEM_ART_A } from './crest-emblem-art-a';
import { CREST_EMBLEM_ART_B } from './crest-emblem-art-b';

/** One emblem's SVG: a viewBox and the path data, each path filled with `currentColor`. */
export interface CrestEmblemArt {
    viewBox: string;
    paths: readonly string[];
}

/** Emblem id → art. A full Record, so a new contract id fails the build until it has art. */
export const CREST_EMBLEMS: Record<GuildCrestEmblemId, CrestEmblemArt> = {
    ...CREST_EMBLEM_ART_A,
    ...CREST_EMBLEM_ART_B,
};
