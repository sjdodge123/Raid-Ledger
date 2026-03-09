import { Inject, Injectable, ConflictException, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq, sql, ilike, and, ne, gte, desc } from 'drizzle-orm';
import type {
  UserRole,
  ActivityPeriod,
  GameActivityEntryDto,
} from '@raid-ledger/contract';
import {
  findAllByGame,
  findAllUsers,
  findAllWithRolesQuery,
  fetchGameActivity,
  fetchHeartedGames,
  deleteUserTransaction,
} from './users-query.helpers';
import { fetchSteamLibrary } from './users-steam-query.helpers';
import { invalidateAuthUser } from '../auth/auth-user-cache';

/** Number of days to look back for "recently joined" users. */
export const RECENT_MEMBER_DAYS = 30;
/** Maximum number of recent members to return. */
export const RECENT_MEMBER_LIMIT = 10;
/** How long the user count cache is considered fresh (ms). */
export const USER_COUNT_CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private cachedUserCount: number | null = null;
  private userCountCachedAt = 0;

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findByDiscordId(discordId: string) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.discordId, discordId),
    });
  }

  async createOrUpdate(profile: {
    discordId: string;
    username: string;
    avatar?: string;
  }) {
    const existing = await this.findByDiscordId(profile.discordId);
    if (existing) {
      const [updated] = await this.db
        .update(schema.users)
        .set({
          username: profile.username,
          avatar: profile.avatar,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.discordId, profile.discordId))
        .returning();
      return updated;
    }
    const [created] = await this.db
      .insert(schema.users)
      .values({
        discordId: profile.discordId,
        username: profile.username,
        avatar: profile.avatar,
      })
      .returning();
    this.invalidateCountCache();
    return created;
  }

  async findById(id: number) {
    return this.db.query.users.findFirst({ where: eq(schema.users.id, id) });
  }

  async setRole(userId: number, role: UserRole) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    invalidateAuthUser(userId);
    return updated;
  }

  /** List all users with role information for admin management panel. */
  async findAllWithRoles(page: number, limit: number, search?: string) {
    return findAllWithRolesQuery(this.db, page, limit, search);
  }

  /** Link a Discord account to an existing user. */
  async linkDiscord(
    userId: number,
    discordId: string,
    username: string,
    avatar?: string,
  ) {
    const existingWithDiscord = await this.findByDiscordId(discordId);
    if (existingWithDiscord && existingWithDiscord.id !== userId) {
      throw new ConflictException(
        'This Discord account is already linked to another user',
      );
    }
    const [updated] = await this.db
      .update(schema.users)
      .set({ discordId, username, avatar, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    invalidateAuthUser(userId);
    return updated;
  }

  /** Unlink Discord from a user account. Preserves ID as 'unlinked:<id>'. */
  async unlinkDiscord(userId: number) {
    const user = await this.findById(userId);
    if (!user || !user.discordId || user.discordId.startsWith('local:'))
      return user;
    const [updated] = await this.db
      .update(schema.users)
      .set({
        discordId: `unlinked:${user.discordId}`,
        avatar: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();
    invalidateAuthUser(userId);
    return updated;
  }

  /** Find a user by Discord ID, including previously unlinked accounts. */
  async findByDiscordIdIncludingUnlinked(discordId: string) {
    const exact = await this.findByDiscordId(discordId);
    if (exact) return exact;
    const unlinked = await this.db.query.users.findFirst({
      where: eq(schema.users.discordId, `unlinked:${discordId}`),
    });
    return unlinked ?? null;
  }

  /** Re-link a previously unlinked Discord account. */
  async relinkDiscord(userId: number, username: string, avatar?: string) {
    const user = await this.findById(userId);
    if (!user?.discordId?.startsWith('unlinked:')) return user;
    const rawDiscordId = user.discordId.replace('unlinked:', '');
    const [updated] = await this.db
      .update(schema.users)
      .set({ discordId: rawDiscordId, username, avatar, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    invalidateAuthUser(userId);
    return updated;
  }

  /** Find a user by Steam ID (ROK-417). */
  async findBySteamId(steamId: string) {
    const result = await this.db.query.users.findFirst({
      where: eq(schema.users.steamId, steamId),
    });
    return result ?? null;
  }

  /** Link a Steam account to an existing user (ROK-417). */
  async linkSteam(userId: number, steamId: string) {
    const existing = await this.findBySteamId(steamId);
    if (existing && existing.id !== userId)
      throw new ConflictException(
        'This Steam account is already linked to another user',
      );
    const [updated] = await this.db
      .update(schema.users)
      .set({ steamId, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /** Unlink Steam from a user account (ROK-417). */
  async unlinkSteam(userId: number) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ steamId: null, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /** Count total users with 5-minute cache (ROK-175 AC-4, ROK-662). */
  async count(): Promise<number> {
    if (
      this.cachedUserCount !== null &&
      Date.now() - this.userCountCachedAt < USER_COUNT_CACHE_TTL_MS
    )
      return this.cachedUserCount;
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users);
    this.cachedUserCount = Number(result[0].count);
    this.userCountCachedAt = Date.now();
    return this.cachedUserCount;
  }

  /** Invalidate cached user count. */
  invalidateCountCache(): void {
    this.cachedUserCount = null;
    this.userCountCachedAt = 0;
  }

  /** Paginated list of all users with optional search and gameId filter. */
  async findAll(page: number, limit: number, search?: string, gameId?: number, source?: string) {
    return gameId
      ? findAllByGame(this.db, page, limit, search, gameId, source)
      : findAllUsers(this.db, page, limit, search);
  }

  /** Find recently joined users (last 30 days, max 10) (ROK-298). */
  async findRecent() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECENT_MEMBER_DAYS);
    return this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        avatar: schema.users.avatar,
        discordId: schema.users.discordId,
        customAvatarUrl: schema.users.customAvatarUrl,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(gte(schema.users.createdAt, cutoff))
      .orderBy(desc(schema.users.createdAt))
      .limit(RECENT_MEMBER_LIMIT);
  }

  async setCustomAvatar(userId: number, url: string | null) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ customAvatarUrl: url, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /** Check if a display name is available (ROK-219). */
  async checkDisplayNameAvailability(
    displayName: string,
    excludeUserId?: number,
  ): Promise<boolean> {
    const conditions = excludeUserId
      ? and(
          ilike(schema.users.displayName, displayName),
          ne(schema.users.id, excludeUserId),
        )
      : ilike(schema.users.displayName, displayName);
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(conditions);
    return Number(result.count) === 0;
  }

  /** Set a user's display name (ROK-219). */
  async setDisplayName(userId: number, displayName: string) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /** Mark onboarding as completed (ROK-219). */
  async completeOnboarding(userId: number) {
    const now = new Date();
    const [updated] = await this.db
      .update(schema.users)
      .set({ onboardingCompletedAt: now, updatedAt: now })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /** Reset onboarding (ROK-219). */
  async resetOnboarding(userId: number) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ onboardingCompletedAt: null, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /** Fetch games a user has hearted, excluding Steam library entries (ROK-282, ROK-754). */
  async getHeartedGames(userId: number, page = 1, limit = 20) {
    return fetchHeartedGames(this.db, userId, page, limit);
  }

  /** Fetch a user's game activity (ROK-443). */
  async getUserActivity(
    userId: number,
    period: ActivityPeriod,
    requesterId?: number,
  ): Promise<GameActivityEntryDto[]> {
    return fetchGameActivity(this.db, userId, period, requesterId);
  }

  /** Fetch a user's Steam library with pagination (ROK-754). */
  async getSteamLibrary(userId: number, page: number, limit: number) {
    return fetchSteamLibrary(this.db, userId, page, limit);
  }

  /** Delete a user and cascade all related data (ROK-405). */
  async deleteUser(userId: number, reassignToUserId: number): Promise<void> {
    await deleteUserTransaction(this.db, userId, reassignToUserId);
    this.invalidateCountCache();
    this.logger.log(
      `User ${userId} deleted. Events reassigned to user ${reassignToUserId}.`,
    );
  }

  /** Find the instance admin (first admin user by ID). */
  async findAdmin(): Promise<{ id: number } | undefined> {
    return this.db.query.users.findFirst({
      where: eq(schema.users.role, 'admin'),
      columns: { id: true },
    });
  }
}
