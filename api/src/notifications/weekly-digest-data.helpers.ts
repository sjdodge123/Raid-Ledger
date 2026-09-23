/**
 * Weekly Discord digest — data assembly (ROK-1435 slice L2).
 *
 * Gathers the four sections the operator ruled on 2026-09-22 (Decision 5a):
 * ① what the community has been playing, ② the last-7-days recap,
 * ③ wishlisted games on sale, ④ live LFG groups — and normalises them into a
 * render-ready {@link DigestSections}. Rendering (truncation to 1024 chars,
 * masked links) is slice L3; scheduling and dispatch are L4.
 *
 * Every source is an EXISTING read — no second definition of any rule:
 * - ① `fetchCommunityPlayingRow` already drops `show_activity=false` members.
 * - ② `fetchWeeklyRecap` with `respectActivityOptOut: true` (Decision 4a).
 * - ③ `fetchWishlistedOnSaleRow` reads DB-persisted ITAD columns only.
 * - ④ `listActiveGroupsForChannel` is viewer-free by construction, so no
 *   per-reader fact (`hasOwnIntent`) can reach a channel embed (AC5/AC10).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type { GameDetailDto, GameDiscoverRowDto } from '@raid-ledger/contract';
import { playersStillNeeded } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { fetchCommunityPlayingRow } from '../igdb/igdb-discover-community-playing.helpers';
import { fetchWishlistedOnSaleRow } from '../igdb/igdb-discover-deals.helpers';
import { buildCommunityPlayingCategory } from '../igdb/igdb-discover.helpers';
import { IGDB_CONFIG } from '../igdb/igdb.constants';
import {
  deriveViability,
  listActiveGroupsForChannel,
  type LfgGroupAggregate,
} from '../lfg/lfg-query.helpers';
import {
  fetchWeeklyRecap,
  isEmptyWeeklyRecap,
  type WeeklyRecap,
} from './weekly-digest-recap.helpers';

/** Top-N per section (spec §4). LFG keeps every live group; L3 truncates by length. */
export const DIGEST_PLAYING_LIMIT = 5;
export const DIGEST_DEALS_LIMIT = 3;

export interface DigestGameRef {
  gameId: number;
  name: string;
  slug: string;
}

export interface DigestPlayingLine extends DigestGameRef {
  playerCount: number;
}

export interface DigestDealLine extends DigestGameRef {
  /** Discount percentage, 1–100. */
  cutPercent: number;
  /** Current best price, or null when ITAD has no price. */
  price: number | null;
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

export interface DigestSections {
  playing: DigestSection<DigestPlayingLine>;
  /** Null when nothing ran in the window. */
  recap: WeeklyRecap | null;
  deals: DigestSection<DigestDealLine>;
  lfg: DigestSection<DigestLfgLine>;
}

/** The four reads, injectable so the assembly is unit-testable. */
export interface DigestSources {
  communityPlaying: () => Promise<GameDiscoverRowDto>;
  recap: () => Promise<WeeklyRecap>;
  wishlistedOnSale: () => Promise<GameDiscoverRowDto>;
  lfgGroups: () => Promise<LfgGroupAggregate[]>;
}

/** Called once per section that failed; the section is then empty. */
export type DigestSectionErrorHandler = (
  section: keyof DigestSections,
  error: unknown,
) => void;

/** Wire the production reads. */
export function buildDigestSources(
  db: PostgresJsDatabase<typeof schema>,
  redis: Redis,
  cacheTtl: number = IGDB_CONFIG.DISCOVER_CACHE_TTL,
): DigestSources {
  return {
    communityPlaying: () =>
      fetchCommunityPlayingRow(
        db,
        redis,
        buildCommunityPlayingCategory(),
        cacheTtl,
      ),
    recap: () => fetchWeeklyRecap(db, { respectActivityOptOut: true }),
    wishlistedOnSale: () => fetchWishlistedOnSaleRow(db, redis, cacheTtl),
    lfgGroups: () => listActiveGroupsForChannel(db),
  };
}

function toGameRef(game: GameDetailDto): DigestGameRef {
  return { gameId: game.id, name: game.name, slug: game.slug };
}

/** ① Top games by distinct players, in the row's own rank order. */
export function shapePlaying(
  row: GameDiscoverRowDto,
): DigestSection<DigestPlayingLine> {
  const metadata = row.metadata ?? {};
  const lines = row.games
    .map((game) => ({
      ...toGameRef(game),
      playerCount: metadata[String(game.id)]?.playerCount ?? 0,
    }))
    .filter((line) => line.playerCount > 0);
  return { items: lines.slice(0, DIGEST_PLAYING_LIMIT), total: lines.length };
}

/** ③ Top deals; a game without a positive discount is not a deal. */
export function shapeDeals(
  row: GameDiscoverRowDto,
): DigestSection<DigestDealLine> {
  const lines = row.games
    .filter((game) => (game.itadCurrentCut ?? 0) > 0)
    .map((game) => ({
      ...toGameRef(game),
      cutPercent: game.itadCurrentCut ?? 0,
      price: game.itadCurrentPrice ?? null,
    }));
  return { items: lines.slice(0, DIGEST_DEALS_LIMIT), total: lines.length };
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

/** True when every section is empty — L4 then skips the post (spec §5). */
export function isDigestEmpty(sections: DigestSections): boolean {
  return (
    sections.playing.items.length === 0 &&
    sections.recap === null &&
    sections.deals.items.length === 0 &&
    sections.lfg.items.length === 0
  );
}

function emptySection<T>(): DigestSection<T> {
  return { items: [], total: 0 };
}

/** Run one read; a failure degrades that section only. */
async function settle<T, R>(
  section: keyof DigestSections,
  read: () => Promise<T>,
  shape: (value: T) => R,
  fallback: R,
  onError?: DigestSectionErrorHandler,
): Promise<R> {
  try {
    return shape(await read());
  } catch (error) {
    onError?.(section, error);
    return fallback;
  }
}

/**
 * Assemble all four sections concurrently. One failing source (Redis down,
 * a slow ITAD table) empties its own section instead of losing the week.
 */
export async function assembleDigestSections(
  sources: DigestSources,
  onError?: DigestSectionErrorHandler,
): Promise<DigestSections> {
  const [playing, recap, deals, lfg] = await Promise.all([
    settle(
      'playing',
      sources.communityPlaying,
      shapePlaying,
      emptySection(),
      onError,
    ),
    settle('recap', sources.recap, shapeRecap, null, onError),
    settle(
      'deals',
      sources.wishlistedOnSale,
      shapeDeals,
      emptySection(),
      onError,
    ),
    settle('lfg', sources.lfgGroups, shapeLfg, emptySection(), onError),
  ]);
  return { playing, recap, deals, lfg };
}
