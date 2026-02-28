import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, ilike, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ActivityType, type GuildMember } from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';

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
 * - If 50%+ of members play the same game, that game wins
 * - Otherwise, split into separate groups per game
 */
@Injectable()
export class PresenceGameDetectorService {
  private readonly logger = new Logger(PresenceGameDetectorService.name);

  /** Manual /playing overrides: discordUserId -> override */
  private manualOverrides = new Map<string, ManualOverride>();

  /** Cache: activityName -> resolved game info */
  private gameCache = new Map<string, CachedGameEntry>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

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

    // Collect activity names per member
    const memberActivities = new Map<string, string | null>();

    for (const member of members) {
      // Check manual override first
      const override = this.getManualOverride(member.id);
      if (override) {
        memberActivities.set(member.id, override);
        continue;
      }

      // Read Discord Rich Presence
      const playingActivity = member.presence?.activities?.find(
        (a) => a.type === ActivityType.Playing,
      );
      memberActivities.set(member.id, playingActivity?.name ?? null);
    }

    // Resolve activity names to games
    const gamesByMember = new Map<
      string,
      { gameId: number | null; gameName: string }
    >();

    for (const [memberId, activityName] of memberActivities) {
      if (!activityName) {
        // No activity detected — will be grouped as fallback
        gamesByMember.set(memberId, {
          gameId: null,
          gameName: 'Untitled Gaming Session',
        });
        continue;
      }

      const resolved = await this.resolveGame(activityName);
      gamesByMember.set(memberId, resolved);
    }

    // Group members by resolved game
    const groups = new Map<string, DetectedGameGroup>();
    for (const [memberId, game] of gamesByMember) {
      // Use gameId as key for matched games, gameName for unmatched
      const key =
        game.gameId !== null ? `id:${game.gameId}` : `name:${game.gameName}`;
      const existing = groups.get(key);
      if (existing) {
        existing.memberIds.push(memberId);
      } else {
        groups.set(key, {
          gameId: game.gameId,
          gameName: game.gameName,
          memberIds: [memberId],
        });
      }
    }

    // Apply consensus logic
    const totalMembers = members.length;
    const groupArray = [...groups.values()];

    // Check if any single game has 50%+ majority
    const majorityGroup = groupArray.find(
      (g) => g.memberIds.length >= totalMembers / 2 && g.gameId !== null,
    );

    if (majorityGroup) {
      // Majority consensus — all members join this game's event
      return [
        {
          gameId: majorityGroup.gameId,
          gameName: majorityGroup.gameName,
          memberIds: members.map((m) => m.id),
        },
      ];
    }

    // No majority — check if everyone has no game detected
    const allNoGame = groupArray.every((g) => g.gameId === null);
    if (allNoGame) {
      return [
        {
          gameId: null,
          gameName: 'Untitled Gaming Session',
          memberIds: members.map((m) => m.id),
        },
      ];
    }

    // Split into separate groups — filter out single-member "no game" entries
    // and merge them into the largest game group
    const gameGroups = groupArray.filter((g) => g.gameId !== null);
    const noGameMembers = groupArray
      .filter((g) => g.gameId === null)
      .flatMap((g) => g.memberIds);

    if (gameGroups.length === 0) {
      // Shouldn't happen given allNoGame check above, but be safe
      return [
        {
          gameId: null,
          gameName: 'Untitled Gaming Session',
          memberIds: members.map((m) => m.id),
        },
      ];
    }

    // Assign no-game members to the largest game group
    if (noGameMembers.length > 0) {
      const largest = gameGroups.reduce((a, b) =>
        a.memberIds.length >= b.memberIds.length ? a : b,
      );
      largest.memberIds.push(...noGameMembers);
    }

    return gameGroups;
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
    // Check cache
    const cached = this.gameCache.get(activityName);
    if (cached && Date.now() - cached.cachedAt < GAME_CACHE_TTL_MS) {
      return { gameId: cached.gameId, gameName: cached.gameName };
    }

    // 1. Check discord_game_mappings (admin overrides)
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

    if (mapping) {
      this.cacheGame(activityName, mapping.gameId, mapping.gameName);
      return { gameId: mapping.gameId, gameName: mapping.gameName };
    }

    // 2. Exact match against games.name
    const [exactMatch] = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.name, activityName))
      .limit(1);

    if (exactMatch) {
      this.cacheGame(activityName, exactMatch.id, exactMatch.name);
      return { gameId: exactMatch.id, gameName: exactMatch.name };
    }

    // 3. Case-insensitive match (ILIKE)
    const [fuzzyMatch] = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(ilike(schema.games.name, activityName))
      .limit(1);

    if (fuzzyMatch) {
      this.cacheGame(activityName, fuzzyMatch.id, fuzzyMatch.name);
      return { gameId: fuzzyMatch.id, gameName: fuzzyMatch.name };
    }

    // 4. Trigram similarity search (fuzzy matching for typos/abbreviations)
    // Uses pg_trgm extension if available — gracefully falls back
    try {
      const [trigramMatch] = await this.db
        .select({ id: schema.games.id, name: schema.games.name })
        .from(schema.games)
        .where(sql`similarity(${schema.games.name}, ${activityName}) > 0.3`)
        .orderBy(sql`similarity(${schema.games.name}, ${activityName}) DESC`)
        .limit(1);

      if (trigramMatch) {
        this.cacheGame(activityName, trigramMatch.id, trigramMatch.name);
        this.logger.debug(
          `Fuzzy matched "${activityName}" -> "${trigramMatch.name}" (id=${trigramMatch.id})`,
        );
        return { gameId: trigramMatch.id, gameName: trigramMatch.name };
      }
    } catch {
      // pg_trgm extension may not be installed — skip trigram matching
      this.logger.debug(
        `Trigram matching unavailable for "${activityName}" — pg_trgm may not be installed`,
      );
    }

    // 5. No match — use activity name as-is with null gameId
    this.cacheGame(activityName, null, activityName);
    return { gameId: null, gameName: activityName };
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
