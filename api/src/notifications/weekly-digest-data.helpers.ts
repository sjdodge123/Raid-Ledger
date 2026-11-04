/**
 * Weekly Discord digest — section types and shaping (ROK-1435 slice L2;
 * v2 ROK-1771). The shared line types the embed renders, plus the pure
 * shapers for the v1 sections that v2 keeps: ① what the community has been
 * playing together (ROK-2063 co-play), ② the last-7-days recap and ④ live LFG groups. The v1 "on sale"
 * deals are gone (replaced by Best price, ruling §11). Source wiring and the
 * concurrent assembly live in `weekly-digest-assembly.helpers.ts`.
 *
 * `shapeLfg` projects onto viewer-independent fields only, so no per-reader
 * fact (`hasOwnIntent`) can reach a channel embed (AC5/AC10).
 */
import { playersStillNeeded } from '@raid-ledger/contract';
import {
  deriveViability,
  type LfgGroupAggregate,
} from '../lfg/lfg-query.helpers';
import type { CoPlayGame } from './weekly-digest-coplay.queries';
import {
  isEmptyWeeklyRecap,
  type WeeklyRecap,
} from './weekly-digest-recap.helpers';

/** Top-N for Been playing (spec §4). LFG keeps every live group; L3 truncates by length. */
export const DIGEST_PLAYING_LIMIT = 5;

export interface DigestGameRef {
  gameId: number;
  name: string;
  slug: string;
}

export interface DigestPlayingLine extends DigestGameRef {
  playerCount: number;
}

/** Viewer-independent LFG facts only — never `hasOwnIntent`. */
export interface DigestLfgLine {
  gameName: string;
  gameSlug: string;
  activeCount: number;
  nowCount: number;
  isViable: boolean;
  /** Players still needed; meaningless once `isViable`. */
  playersNeeded: number;
}

/** A section's shown items plus the full count, so L3 can add "see all". */
export interface DigestSection<T> {
  items: T[];
  total: number;
}

/**
 * ① Top games played together (ROK-2063), in the co-play read's rank order.
 * `total` counts the whole filtered set, so "+N more" never counts solo play.
 */
export function shapePlaying(
  games: readonly CoPlayGame[],
): DigestSection<DigestPlayingLine> {
  const lines = games
    .filter((game) => game.players > 0)
    .map((game) => ({
      gameId: game.gameId,
      name: game.name,
      slug: game.slug,
      playerCount: game.players,
    }));
  return { items: lines.slice(0, DIGEST_PLAYING_LIMIT), total: lines.length };
}

/** ④ Project each live group onto viewer-independent fields. */
export function shapeLfg(
  groups: LfgGroupAggregate[],
): DigestSection<DigestLfgLine> {
  const lines = groups
    .filter((group) => group.activeCount > 0)
    .map((group) => {
      const threshold = group.viabilityThreshold;
      return {
        gameName: group.gameName,
        gameSlug: group.gameSlug,
        activeCount: group.activeCount,
        nowCount: group.nowCount,
        isViable: deriveViability(group.activeCount, threshold),
        playersNeeded: playersStillNeeded(group.activeCount, threshold),
      };
    });
  return { items: lines, total: lines.length };
}

/** ② A recap with nothing run is no section at all. */
export function shapeRecap(recap: WeeklyRecap): WeeklyRecap | null {
  return isEmptyWeeklyRecap(recap) ? null : recap;
}

/** A section with nothing in it. */
export function emptySection<T>(): DigestSection<T> {
  return { items: [], total: 0 };
}
