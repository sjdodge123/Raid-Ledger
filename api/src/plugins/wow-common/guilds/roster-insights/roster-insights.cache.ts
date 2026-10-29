import { Inject, Injectable, type Logger } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import { memorySwr, type MemoryCacheEntry } from '../../../../common/swr-cache';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { liveMemberPredicate } from '../../../../guilds/community/community-membership.queries';

/** 5 minutes, the quest-coverage pattern (ROK-1748 D10). */
export const ROSTER_INSIGHTS_TTL_MS = 5 * 60 * 1000;

/**
 * ROK-1913 — in-memory SWR of roster insights keyed by guild + audience (+
 * the mains-only flag). An addon import drops every entry of each guild the
 * imported character sits in, so a guild or char import shows on next read.
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

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Cached insights, or `fetcher` on a miss/expiry (refreshed when stale). */
  get(
    key: string,
    fetcher: () => Promise<WowRosterInsightsDto>,
  ): Promise<WowRosterInsightsDto> {
    return memorySwr({
      cache: this.cache,
      key,
      ttlMs: ROSTER_INSIGHTS_TTL_MS,
      fetcher: () => this.fetchCurrent(key, fetcher),
    });
  }

  /** Drop every cached entry of one guild (all audiences); bump generations. */
  invalidateGuild(guildId: number): void {
    const prefix = `${INSIGHTS_KEY_PREFIX}${guildId}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
    for (const [key, gen] of this.generations) {
      if (key.startsWith(prefix)) this.generations.set(key, gen + 1);
    }
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
   * whose roster carries the character's GUID, and (ROK-1925 Q4) each
   * community hub its owner is a live member of. Best effort — a failed
   * lookup leaves the 5-minute TTL as the bound.
   */
  async invalidateForCharacter(characterId: string): Promise<void> {
    const { characters, guildMembers, hubCommunityMembers: m } = schema;
    const [guildRows, hubRows] = await Promise.all([
      this.db
        .selectDistinct({ guildId: guildMembers.guildId })
        .from(guildMembers)
        .innerJoin(characters, eq(characters.addonGuid, guildMembers.guid))
        .where(
          and(eq(characters.id, characterId), isNotNull(guildMembers.guid)),
        ),
      this.db
        .selectDistinct({ guildId: m.guildId })
        .from(m)
        .innerJoin(characters, eq(characters.userId, m.userId))
        .where(and(eq(characters.id, characterId), liveMemberPredicate())),
    ]);
    for (const { guildId } of [...guildRows, ...hubRows])
      this.invalidateGuild(guildId);
  }
}

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

/**
 * Post-import hook: drop the imported character's guilds from the insights
 * cache. Never throws — a failed invalidation must not fail an applied import.
 */
export async function invalidateRosterInsights(
  cache: Pick<RosterInsightsCache, 'invalidateForCharacter'>,
  characterId: string | null,
  logger: Pick<Logger, 'warn'>,
): Promise<void> {
  if (characterId === null) return;
  try {
    await cache.invalidateForCharacter(characterId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`roster-insights invalidation failed: ${msg}`);
  }
}
