import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq, ilike, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ActivityType, type GuildMember } from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { groupByGame, applyConsensus } from './presence-game-detector.helpers';

/** TTL for manual /playing overrides (30 minutes). */
const MANUAL_OVERRIDE_TTL_MS = 30 * 60 * 1000;

/** TTL for game name resolution cache entries (10 minutes). */
const GAME_CACHE_TTL_MS = 10 * 60 * 1000;

/** Result of game detection for a set of members. */
export interface DetectedGameGroup {
  gameId: number | null;
  gameName: string;
  memberIds: string[];
}

interface CachedGameEntry {
  gameId: number | null;
  gameName: string;
  cachedAt: number;
}

interface ManualOverride {
  gameName: string;
  setAt: number;
}

/**
 * PresenceGameDetector — detects which game(s) members are playing in a
 * general-lobby voice channel via Discord Rich Presence.
 *
 * Game resolution pipeline:
 * 1. Manual /playing overrides (highest priority)
 * 2. discord_game_mappings table (admin overrides)
 * 3. Exact match against games.name
 * 4. Case-insensitive fuzzy match (ILIKE) against games.name
 * 5. Fallback: "Untitled Gaming Session" with gameId: null
 *
 * Consensus logic:
 * - If a strict majority (>50%) of members play the same game, that game wins
 * - Otherwise, split into separate groups per game
 */
@Injectable()
export class PresenceGameDetectorService implements OnModuleInit {
  private readonly logger = new Logger(PresenceGameDetectorService.name);

  /**
   * Manual /playing overrides: discordUserId -> override.
   *
   * TODO: These in-memory Maps (manualOverrides, gameCache) are singletons that
   * will diverge across replicas in a multi-instance deployment. When scaling
   * beyond a single server, move to Redis or a shared DB-backed cache.
   */
  private manualOverrides = new Map<string, ManualOverride>();

  /** Cache: activityName -> resolved game info */
  private gameCache = new Map<string, CachedGameEntry>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const result = await this.db.execute(
        sql`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`,
      );
      if (result.length === 0) {
        this.logger.warn(
          'pg_trgm extension is not installed — fuzzy game matching (trigram similarity) will be unavailable. ' +
            'Install with: CREATE EXTENSION IF NOT EXISTS pg_trgm;',
        );
      } else {
        this.logger.log(
          'pg_trgm extension detected — fuzzy game matching enabled',
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to check for pg_trgm extension: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Set a manual game override for a user (via /playing command).
   */
  setManualOverride(discordUserId: string, gameName: string): void {
    this.manualOverrides.set(discordUserId, {
      gameName,
      setAt: Date.now(),
    });
  }

  /**
   * Clear a manual override for a user.
   */
  clearManualOverride(discordUserId: string): void {
    this.manualOverrides.delete(discordUserId);
  }

  /**
   * Get the manual override for a user, if any and not expired.
   */
  getManualOverride(discordUserId: string): string | null {
    const override = this.manualOverrides.get(discordUserId);
    if (!override) return null;
    if (Date.now() - override.setAt > MANUAL_OVERRIDE_TTL_MS) {
      this.manualOverrides.delete(discordUserId);
      return null;
    }
    return override.gameName;
  }

  /**
   * Detect game(s) being played by a set of members in a general-lobby channel.
   * Returns one or more game groups based on consensus logic.
   */
  async detectGames(members: GuildMember[]): Promise<DetectedGameGroup[]> {
    if (members.length === 0) return [];

    const memberActivities = this.collectActivities(members);
    const gamesByMember = await this.resolveActivities(memberActivities);
    const groups = groupByGame(gamesByMember);

    return applyConsensus(groups, members);
  }

  /** Collect activity name (or manual override) per member. */
  private collectActivities(
    members: GuildMember[],
  ): Map<string, string | null> {
    const result = new Map<string, string | null>();
    for (const member of members) {
      const override = this.getManualOverride(member.id);
      if (override) {
        result.set(member.id, override);
        continue;
      }
      const playing = member.presence?.activities?.find(
        (a) => a.type === ActivityType.Playing,
      );
      result.set(member.id, playing?.name ?? null);
    }
    return result;
  }

  /** Resolve activity names to game info. */
  private async resolveActivities(
    activities: Map<string, string | null>,
  ): Promise<Map<string, { gameId: number | null; gameName: string }>> {
    const result = new Map<
      string,
      { gameId: number | null; gameName: string }
    >();
    for (const [memberId, name] of activities) {
      if (!name) {
        result.set(memberId, {
          gameId: null,
          gameName: 'Untitled Gaming Session',
        });
        continue;
      }
      result.set(memberId, await this.resolveGame(name));
    }
    return result;
  }

  /**
   * Detect game for a single member joining a general-lobby channel.
   * Returns the resolved game info.
   */
  async detectGameForMember(
    member: GuildMember,
  ): Promise<{ gameId: number | null; gameName: string }> {
    // Check manual override first
    const override = this.getManualOverride(member.id);
    if (override) {
      return this.resolveGame(override);
    }

    // Read Discord Rich Presence
    const playingActivity = member.presence?.activities?.find(
      (a) => a.type === ActivityType.Playing,
    );

    if (!playingActivity) {
      const activitySummary = member.presence?.activities?.length
        ? member.presence.activities
            .map((a) => `${a.type}:${a.name}`)
            .join(', ')
        : 'no-presence';
      this.logger.debug(
        `No Playing activity for member ${member.id} (activities: [${activitySummary}])`,
      );
      return { gameId: null, gameName: 'Untitled Gaming Session' };
    }

    return this.resolveGame(playingActivity.name);
  }

  /**
   * Resolve a Discord activity name to a game in the registry.
   * Pipeline: manual mappings -> exact match -> case-insensitive match
   */
  async resolveGame(
    activityName: string,
  ): Promise<{ gameId: number | null; gameName: string }> {
    const cached = this.gameCache.get(activityName);
    if (cached && Date.now() - cached.cachedAt < GAME_CACHE_TTL_MS) {
      return { gameId: cached.gameId, gameName: cached.gameName };
    }

    const result =
      (await this.resolveViaMapping(activityName)) ??
      (await this.resolveViaExactMatch(activityName)) ??
      (await this.resolveViaIlike(activityName)) ??
      (await this.resolveViaTrigram(activityName));

    if (result) {
      this.cacheGame(activityName, result.gameId, result.gameName);
      return result;
    }

    this.logger.warn(
      `Game detection fell through to null for "${activityName}"`,
    );
    this.cacheGame(activityName, null, activityName);
    return { gameId: null, gameName: activityName };
  }

  /** Step 1: Check discord_game_mappings table (admin overrides). */
  private async resolveViaMapping(
    activityName: string,
  ): Promise<{ gameId: number; gameName: string } | null> {
    const [mapping] = await this.db
      .select({
        gameId: schema.discordGameMappings.gameId,
        gameName: schema.games.name,
      })
      .from(schema.discordGameMappings)
      .innerJoin(
        schema.games,
        eq(schema.discordGameMappings.gameId, schema.games.id),
      )
      .where(eq(schema.discordGameMappings.discordActivityName, activityName))
      .limit(1);
    return mapping
      ? { gameId: mapping.gameId, gameName: mapping.gameName }
      : null;
  }

  /** Step 2: Exact match against games.name. */
  private async resolveViaExactMatch(
    activityName: string,
  ): Promise<{ gameId: number; gameName: string } | null> {
    const [match] = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.name, activityName))
      .limit(1);
    return match ? { gameId: match.id, gameName: match.name } : null;
  }

  /** Step 3: Case-insensitive match (ILIKE). */
  private async resolveViaIlike(
    activityName: string,
  ): Promise<{ gameId: number; gameName: string } | null> {
    const [match] = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(ilike(schema.games.name, activityName))
      .limit(1);
    return match ? { gameId: match.id, gameName: match.name } : null;
  }

  /** Step 4: Trigram similarity search (pg_trgm). */
  private async resolveViaTrigram(
    activityName: string,
  ): Promise<{ gameId: number; gameName: string } | null> {
    try {
      const [match] = await this.db
        .select({ id: schema.games.id, name: schema.games.name })
        .from(schema.games)
        .where(sql`similarity(${schema.games.name}, ${activityName}) > 0.3`)
        .orderBy(sql`similarity(${schema.games.name}, ${activityName}) DESC`)
        .limit(1);
      if (match) {
        this.logger.debug(`Fuzzy matched "${activityName}" -> "${match.name}"`);
        return { gameId: match.id, gameName: match.name };
      }
    } catch {
      this.logger.debug(`Trigram unavailable for "${activityName}"`);
    }
    return null;
  }

  private cacheGame(
    activityName: string,
    gameId: number | null,
    gameName: string,
  ): void {
    this.gameCache.set(activityName, {
      gameId,
      gameName,
      cachedAt: Date.now(),
    });
  }
}
