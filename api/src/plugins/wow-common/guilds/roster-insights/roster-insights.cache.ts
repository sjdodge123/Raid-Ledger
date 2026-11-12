import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import { memorySwr, type MemoryCacheEntry } from '../../../../common/swr-cache';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { liveMemberPredicate } from '../../../../guilds/community/community-membership.queries';
import { characterLink } from '../guild-link.predicates';
import { pullScopeHubIds, type PullScope } from './roster-insights.pull-scope';
import type { InsightsAudience } from './roster-insights.types';

/** 5 minutes, the quest-coverage pattern (ROK-1748 D10). */
export const ROSTER_INSIGHTS_TTL_MS = 5 * 60 * 1000;
/** `memorySwr`'s default: an entry turns stale in its last 20%. */
const STALE_RATIO = 0.2;
/** A warm superseded this many times in a row gives up (the key stays absent). */
const MAX_WARM_ATTEMPTS = 3;

/**
 * ROK-1913 — in-memory SWR of roster insights keyed by guild + audience (+
 * the mains-only flag). An addon import drops every entry of each guild the
 * imported character sits in, so a guild or char import shows on next read.
 * ROK-2178 (R2): the dropped keys are then recomputed in the background
 * (`registerRecompute`), so the next viewer after an import gets a hit.
 */
@Injectable()
export class RosterInsightsCache {
  private readonly cache = new Map<
    string,
    MemoryCacheEntry<WowRosterInsightsDto>
  >();
  /**
   * Per-key generation, bumped by every invalidation of the key's guild. A
   * fetch that started under an older generation is stale: its result is
   * dropped and the fetch re-runs, so an in-flight refresh can never write
   * pre-invalidation data back into the cache.
   */
  private readonly generations = new Map<string, number>();

  /** Background recompute in flight per key (at most one; see `warm`). */
  private readonly warming = new Map<string, Promise<void>>();
  private recompute: InsightsRecompute | null = null;
  private readonly logger = new Logger(RosterInsightsCache.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Register the uncached compute that warms dropped keys (the service does
   * it on init — a callback, so the cache never imports the service).
   */
  registerRecompute(fn: InsightsRecompute): void {
    this.recompute = fn;
  }

  /**
   * Cached insights, or `fetcher` on a miss/expiry (refreshed when stale). A
   * miss while the key is being warmed waits for that warm instead.
   */
  async get(
    key: string,
    fetcher: () => Promise<WowRosterInsightsDto>,
  ): Promise<WowRosterInsightsDto> {
    const warming = this.warming.get(key);
    if (warming && !this.cache.has(key)) await warming;
    return memorySwr({
      cache: this.cache,
      key,
      ttlMs: ROSTER_INSIGHTS_TTL_MS,
      fetcher: () => this.fetchCurrent(key, fetcher),
    });
  }

  /**
   * Drop every cached entry of one guild (all audiences), bump generations,
   * then warm the dropped keys in the background (never awaited).
   */
  invalidateGuild(guildId: number): void {
    const prefix = `${INSIGHTS_KEY_PREFIX}${guildId}:`;
    const dropped = [...this.cache.keys()].filter((k) => k.startsWith(prefix));
    for (const key of dropped) this.cache.delete(key);
    for (const [key, gen] of this.generations) {
      if (key.startsWith(prefix)) this.generations.set(key, gen + 1);
    }
    for (const key of dropped) this.scheduleWarm(key);
  }

  /** Start a warm of `key` unless one is in flight (it re-runs on its own). */
  private scheduleWarm(key: string): void {
    const recompute = this.recompute;
    const params = parseInsightsKey(key);
    if (!recompute || !params || this.warming.has(key)) return;
    const run = (): Promise<WowRosterInsightsDto> =>
      recompute(params.guildId, params.audience, params.onlyMains);
    this.warming.set(key, this.warm(key, run));
  }

  /**
   * Recompute `key` and store it only if no invalidation landed meanwhile
   * (generation guard); a superseded result is dropped and the compute
   * re-runs. Failures are logged and leave the key absent. The in-flight
   * marker is cleared in the same tick as the final check, so a later
   * invalidation always schedules a fresh warm.
   */
  private async warm(
    key: string,
    run: () => Promise<WowRosterInsightsDto>,
  ): Promise<void> {
    try {
      for (let attempt = 0; attempt < MAX_WARM_ATTEMPTS; attempt++) {
        const gen = this.generations.get(key) ?? 0;
        const data = await run();
        if ((this.generations.get(key) ?? 0) !== gen) continue;
        this.store(key, data);
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`roster-insights warm failed for ${key}: ${msg}`);
    } finally {
      this.warming.delete(key);
    }
  }

  /** Write a fresh entry with `memorySwr`'s TTL and stale window. */
  private store(key: string, data: WowRosterInsightsDto): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      expiresAt: now + ROSTER_INSIGHTS_TTL_MS,
      staleAt: now + ROSTER_INSIGHTS_TTL_MS * (1 - STALE_RATIO),
    });
  }

  /** Run `fetcher`; re-run once when the key was invalidated meanwhile. */
  private async fetchCurrent(
    key: string,
    fetcher: () => Promise<WowRosterInsightsDto>,
  ): Promise<WowRosterInsightsDto> {
    const gen = this.generations.get(key) ?? 0;
    this.generations.set(key, gen);
    const data = await fetcher();
    if ((this.generations.get(key) ?? 0) === gen) return data;
    return fetcher();
  }

  /**
   * After an applied addon import of `characterId`: invalidate each guild
   * whose roster links the character (`characterLink()`: GUID or Blizzard id), and (ROK-1925 Q4) each
   * community hub its owner is a live member of. Best effort — a failed
   * lookup leaves the 5-minute TTL as the bound.
   */
  async invalidateForCharacter(characterId: string): Promise<void> {
    const { characters, guildMembers, guilds, hubCommunityMembers: m } = schema;
    const [guildRows, hubRows] = await Promise.all([
      this.db
        .selectDistinct({ guildId: guildMembers.guildId })
        .from(guildMembers)
        .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
        .innerJoin(characters, characterLink())
        .where(eq(characters.id, characterId)),
      this.db
        .selectDistinct({ guildId: m.guildId })
        .from(m)
        .innerJoin(characters, eq(characters.userId, m.userId))
        .where(and(eq(characters.id, characterId), liveMemberPredicate())),
    ]);
    for (const { guildId } of [...guildRows, ...hubRows])
      this.invalidateGuild(guildId);
  }

  /**
   * ROK-1917 final P2 — after raid writes: every `wow_guild` hub of the pull
   * scope (an alt without a `guild_members` row finds no guild above).
   */
  async invalidateForPullScope(scope: PullScope): Promise<void> {
    for (const id of await pullScopeHubIds(this.db, scope))
      this.invalidateGuild(id);
  }
}

/** The uncached compute behind one key (the service's `compute`). */
export type InsightsRecompute = (
  guildId: number,
  audience: InsightsAudience,
  onlyMains: boolean,
) => Promise<WowRosterInsightsDto>;

/**
 * Namespace of every insights key: `memorySwr`'s in-flight refresh tracker is
 * module-wide and shared by every cache, so a bare `${guild}:` could collide.
 */
export const INSIGHTS_KEY_PREFIX = 'ri:';

/** Cache key: `ri:` + guild, audience, mains-only. */
export function insightsKey(
  guildId: number,
  audience: string,
  mainsOnly: boolean,
): string {
  return `${INSIGHTS_KEY_PREFIX}${guildId}:${audience}:${mainsOnly ? 'mains' : 'all'}`;
}

/** Inverse of `insightsKey`; null for a key it did not build. */
export function parseInsightsKey(key: string): {
  guildId: number;
  audience: InsightsAudience;
  onlyMains: boolean;
} | null {
  const [ns, guild, audience, mains] = key.split(':');
  const guildId = Number(guild);
  if (`${ns}:` !== INSIGHTS_KEY_PREFIX || !Number.isInteger(guildId))
    return null;
  if (audience !== 'member' && audience !== 'visitor') return null;
  if (mains !== 'mains' && mains !== 'all') return null;
  return { guildId, audience, onlyMains: mains === 'mains' };
}

/**
 * Post-import hook: drop the imported character's guilds — and, after raid
 * writes, every hub of the pull scope (ROK-1917) — from the insights cache.
 * Never throws — a failed invalidation must not fail an applied import.
 */
export async function invalidateRosterInsights(
  cache: Pick<
    RosterInsightsCache,
    'invalidateForCharacter' | 'invalidateForPullScope'
  >,
  characterId: string | null,
  logger: Pick<Logger, 'warn'>,
  pullScope?: PullScope,
): Promise<void> {
  try {
    if (characterId !== null) await cache.invalidateForCharacter(characterId);
    if (pullScope) await cache.invalidateForPullScope(pullScope);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`roster-insights invalidation failed: ${msg}`);
  }
}
