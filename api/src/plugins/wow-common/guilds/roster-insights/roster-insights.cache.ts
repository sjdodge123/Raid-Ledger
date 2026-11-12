import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterInsightsDto } from '@raid-ledger/contract';
import type { MemoryCacheEntry } from '../../../../common/swr-cache';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { liveMemberPredicate } from '../../../../guilds/community/community-membership.queries';
import { characterLink } from '../guild-link.predicates';
import { pullScopeHubIds, type PullScope } from './roster-insights.pull-scope';
import { InsightsFlights } from './roster-insights.cache-flight';
import type { InsightsAudience } from './roster-insights.types';

/** 5 minutes, the quest-coverage pattern (ROK-1748 D10). */
export const ROSTER_INSIGHTS_TTL_MS = 5 * 60 * 1000;
/** `memorySwr`'s default: an entry turns stale in its last 20%. */
const STALE_RATIO = 0.2;

/**
 * ROK-1913 — in-memory SWR of roster insights keyed by guild + audience (+
 * the mains-only flag). An addon import drops every entry of each guild the
 * imported character sits in, so a guild or char import shows on next read.
 * ROK-2178: the dropped keys that were READ within the TTL are recomputed in
 * the background (`registerRecompute`), so the next viewer after an import
 * gets a hit; every compute of a key runs through one coordinator
 * (`InsightsFlights`: one in flight per key, warms capped process-wide).
 */
@Injectable()
export class RosterInsightsCache implements OnModuleDestroy {
  private readonly cache = new Map<
    string,
    MemoryCacheEntry<WowRosterInsightsDto>
  >();
  /** Last `get` per key (a warm is not a read): only these keys re-warm. */
  private readonly lastReadAt = new Map<string, number>();
  private readonly flights = new InsightsFlights({
    store: (key, data) => this.store(key, data),
    isCached: (key) => this.isLive(key),
  });
  private recompute: InsightsRecompute | null = null;

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

  /** Stop warming; wait for running computes before the pool closes. */
  async onModuleDestroy(): Promise<void> {
    await this.flights.close();
  }

  /**
   * Cached insights; stale → served and refreshed in the background; missing
   * or expired → computed, joining any compute of the key in flight (a failed
   * joined warm falls back to this caller's own `fetcher`).
   */
  async get(
    key: string,
    fetcher: () => Promise<WowRosterInsightsDto>,
  ): Promise<WowRosterInsightsDto> {
    const now = Date.now();
    this.lastReadAt.set(key, now);
    const entry = this.cache.get(key);
    if (entry && now < entry.expiresAt) {
      if (now >= entry.staleAt) this.flights.refresh(key, fetcher);
      return entry.data;
    }
    const joined = this.flights.isRunning(key);
    try {
      return (await this.flights.run(key, fetcher)).data;
    } catch (err) {
      if (!joined) throw err;
      return (await this.flights.run(key, fetcher)).data;
    }
  }

  /**
   * Drop every cached entry of one guild (all audiences), supersede its
   * in-flight computes, then queue a warm of each of its keys read within
   * the TTL (never awaited).
   */
  invalidateGuild(guildId: number): void {
    const prefix = `${INSIGHTS_KEY_PREFIX}${guildId}:`;
    for (const key of [...this.cache.keys()])
      if (key.startsWith(prefix)) this.cache.delete(key);
    this.flights.bumpPrefix(prefix);
    for (const key of this.recentlyRead(prefix)) this.scheduleWarm(key);
  }

  /** Keys under `prefix` read within the TTL; older read stamps are pruned. */
  private recentlyRead(prefix: string): string[] {
    const cutoff = Date.now() - ROSTER_INSIGHTS_TTL_MS;
    const keys: string[] = [];
    for (const [key, at] of this.lastReadAt) {
      if (!key.startsWith(prefix)) continue;
      if (at > cutoff) keys.push(key);
      else this.lastReadAt.delete(key);
    }
    return keys;
  }

  private scheduleWarm(key: string): void {
    const recompute = this.recompute;
    const params = parseInsightsKey(key);
    if (!recompute || !params) return;
    this.flights.scheduleWarm(key, () =>
      recompute(params.guildId, params.audience, params.onlyMains),
    );
  }

  /** True when `key` holds an unexpired entry. */
  private isLive(key: string): boolean {
    const entry = this.cache.get(key);
    return entry !== undefined && Date.now() < entry.expiresAt;
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
 * Namespace of every insights key (they once shared `memorySwr`'s module-wide
 * in-flight tracker; the prefix also scopes `invalidateGuild`).
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
