/**
 * Weekly Discord digest v2 — source wiring and assembly (ROK-1771 L6).
 *
 * Gathers every section the v2 embed renders into one
 * {@link DigestSectionsV2}. Each read runs in its own `settle`, so one failing
 * source empties only its own section (or spotlight kind) and never the
 * digest (AC14). Every source is an EXISTING read — no second definition:
 * - Been playing: `fetchCommunityPlayingRow` (v1, drops opted-out members).
 * - Last 7 days + the prior week: `fetchWeeklyRecap` (`endOffsetDays: 7`).
 * - Firsts & milestones: `fetchDigestMilestones` (L2).
 * - Coming up: `fetchWeeklyUpcoming` (L1).
 * - Spotlight: the five L3 candidate reads → `pickSpotlight` (L4).
 * - Looking for group: `listActiveGroupsForChannel` (v1, viewer-free).
 * - Best price: `fetchWishlistedBestPrice` (L7) — replaces v1's deals.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type { GameDiscoverRowDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { fetchCommunityPlayingRow } from '../igdb/igdb-discover-community-playing.helpers';
import { buildCommunityPlayingCategory } from '../igdb/igdb-discover.helpers';
import { IGDB_CONFIG } from '../igdb/igdb.constants';
import {
  listActiveGroupsForChannel,
  type LfgGroupAggregate,
} from '../lfg/lfg-query.helpers';
import {
  fetchWishlistedBestPrice,
  type DigestBestPriceSection,
} from './weekly-digest-best-price.helpers';
import {
  emptySection,
  shapeLfg,
  shapePlaying,
  shapeRecap,
  type DigestLfgLine,
  type DigestPlayingLine,
} from './weekly-digest-data.helpers';
import type { DigestSectionsV2 } from './weekly-digest-embed.helpers';
import {
  fetchDigestMilestones,
  type DigestMilestones,
} from './weekly-digest-milestones.helpers';
import {
  fetchWeeklyRecap,
  type WeeklyRecap,
} from './weekly-digest-recap.helpers';
import { fetchDuoCandidate } from './weekly-digest-spotlight-duo.helpers';
import {
  fetchBossKillsCandidate,
  fetchCommonGroundCandidate,
  fetchMarathonCandidate,
  fetchRisingGameCandidate,
} from './weekly-digest-spotlight-sources.helpers';
import {
  SPOTLIGHT_RARITY,
  pickSpotlight,
  type SpotlightCandidate,
  type SpotlightHistoryEntry,
  type SpotlightKind,
} from './weekly-digest-spotlight.helpers';
import {
  fetchWeeklyUpcoming,
  type WeeklyUpcoming,
} from './weekly-digest-upcoming.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** One spotlight candidate read per kind (L3). */
export type DigestSpotlightSources = Readonly<
  Record<SpotlightKind, () => Promise<SpotlightCandidate | null>>
>;

/** Every v2 read, injectable so the assembly is unit-testable. */
export interface DigestSources {
  communityPlaying: () => Promise<GameDiscoverRowDto>;
  recap: () => Promise<WeeklyRecap>;
  priorRecap: () => Promise<WeeklyRecap>;
  milestones: () => Promise<DigestMilestones>;
  upcoming: () => Promise<WeeklyUpcoming | null>;
  spotlight: DigestSpotlightSources;
  lfgGroups: () => Promise<LfgGroupAggregate[]>;
  bestPrice: () => Promise<DigestBestPriceSection>;
}

/** What `pickSpotlight` needs besides the candidates (spec §3.3). */
export interface DigestSpotlightContext {
  history: readonly SpotlightHistoryEntry[];
  /** This digest's ISO week, `YYYY-Www`. */
  week: string;
}

/** A section, or one spotlight kind, whose read failed. */
export type DigestSectionKey =
  keyof DigestSectionsV2 | `spotlight:${SpotlightKind}`;

/** Called once per failed read; that section (or kind) is then empty. */
export type DigestSectionErrorHandler = (
  section: DigestSectionKey,
  error: unknown,
) => void;

function buildSpotlightSources(db: Db): DigestSpotlightSources {
  return {
    rising_game: () => fetchRisingGameCandidate(db),
    duo: () => fetchDuoCandidate(db),
    boss_kills: () => fetchBossKillsCandidate(db),
    common_ground: () => fetchCommonGroundCandidate(db),
    marathon: () => fetchMarathonCandidate(db),
  };
}

/** Wire the production reads. Both recaps honour the opt-out (4a). */
export function buildDigestSources(
  db: Db,
  redis: Redis,
  cacheTtl: number = IGDB_CONFIG.DISCOVER_CACHE_TTL,
): DigestSources {
  const category = buildCommunityPlayingCategory();
  return {
    communityPlaying: () =>
      fetchCommunityPlayingRow(db, redis, category, cacheTtl),
    recap: () => fetchWeeklyRecap(db, { respectActivityOptOut: true }),
    priorRecap: () =>
      fetchWeeklyRecap(db, { respectActivityOptOut: true, endOffsetDays: 7 }),
    milestones: () => fetchDigestMilestones(db),
    upcoming: () => fetchWeeklyUpcoming(db),
    spotlight: buildSpotlightSources(db),
    lfgGroups: () => listActiveGroupsForChannel(db),
    bestPrice: () => fetchWishlistedBestPrice(db),
  };
}

/** Run one read; a failure degrades that section only. */
async function settle<T, R>(
  section: DigestSectionKey,
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

/** Pass a read's value through unchanged, widened to admit the null fallback. */
function keep<T>(value: T): T | null {
  return value;
}

/** Every candidate in its own settle, then the one pick (AC2/AC3). */
async function gatherSpotlight(
  sources: DigestSpotlightSources,
  context: DigestSpotlightContext,
  onError?: DigestSectionErrorHandler,
): Promise<SpotlightCandidate | null> {
  const found = await Promise.all(
    SPOTLIGHT_RARITY.map((kind) =>
      settle(`spotlight:${kind}`, sources[kind], keep, null, onError),
    ),
  );
  const candidates = found.filter((c): c is SpotlightCandidate => c !== null);
  return pickSpotlight(candidates, context.history, context.week);
}

type Activity = Pick<
  DigestSectionsV2,
  'playing' | 'recap' | 'priorRecap' | 'milestones'
>;
type Outlook = Pick<DigestSectionsV2, 'upcoming' | 'lfg' | 'bestPrice'>;

/** Looking back: Been playing, both recaps, Firsts & milestones. */
async function gatherActivity(
  s: DigestSources,
  onError?: DigestSectionErrorHandler,
): Promise<Activity> {
  const noPlaying = emptySection<DigestPlayingLine>();
  const [playing, recap, priorRecap, milestones] = await Promise.all([
    settle('playing', s.communityPlaying, shapePlaying, noPlaying, onError),
    settle('recap', s.recap, shapeRecap, null, onError),
    settle('priorRecap', s.priorRecap, keep, null, onError),
    settle('milestones', s.milestones, keep, null, onError),
  ]);
  return { playing, recap, priorRecap, milestones };
}

/** Looking ahead: Coming up, Looking for group, Best price. */
async function gatherOutlook(
  s: DigestSources,
  onError?: DigestSectionErrorHandler,
): Promise<Outlook> {
  const noLfg = emptySection<DigestLfgLine>();
  const [upcoming, lfg, bestPrice] = await Promise.all([
    settle('upcoming', s.upcoming, keep, null, onError),
    settle('lfg', s.lfgGroups, shapeLfg, noLfg, onError),
    settle('bestPrice', s.bestPrice, keep, null, onError),
  ]);
  return { upcoming, lfg, bestPrice };
}

/** Assemble every v2 section concurrently (all three groups start at once). */
export async function assembleDigestSections(
  sources: DigestSources,
  context: DigestSpotlightContext,
  onError?: DigestSectionErrorHandler,
): Promise<DigestSectionsV2> {
  const [spotlight, activity, outlook] = await Promise.all([
    gatherSpotlight(sources.spotlight, context, onError),
    gatherActivity(sources, onError),
    gatherOutlook(sources, onError),
  ]);
  return { spotlight, ...activity, ...outlook };
}
