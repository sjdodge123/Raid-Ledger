import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq, sql, ilike, asc, and, gte, desc, ne } from 'drizzle-orm';
import type { UserRole } from '@raid-ledger/contract';

/** Number of days to look back for "recently joined" users. */
export const RECENT_MEMBER_DAYS = 30;

/** Maximum number of recent members to return. */
export const RECENT_MEMBER_LIMIT = 10;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findByDiscordId(discordId: string) {
    const result = await this.db.query.users.findFirst({
      where: eq(schema.users.discordId, discordId),
    });
    return result;
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

    return created;
  }

  async findById(id: number) {
    return this.db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
  }

  async setRole(userId: number, role: UserRole) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /**
   * List all users with role information for admin management panel.
   */
  async findAllWithRoles(
    page: number,
    limit: number,
    search?: string,
  ): Promise<{
    data: Array<{
      id: number;
      username: string;
      avatar: string | null;
      discordId: string | null;
      customAvatarUrl: string | null;
      role: UserRole;
      createdAt: Date;
    }>;
    total: number;
  }> {
    const offset = (page - 1) * limit;

    const conditions = search
      ? ilike(schema.users.username, `%${search}%`)
      : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(conditions);

    const rows = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        avatar: schema.users.avatar,
        discordId: schema.users.discordId,
        customAvatarUrl: schema.users.customAvatarUrl,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(conditions)
      .orderBy(asc(schema.users.username))
      .limit(limit)
      .offset(offset);

    return {
      data: rows,
      total: Number(countResult.count),
    };
  }

  /**
   * Link a Discord account to an existing user.
   * Throws ConflictException if Discord account is already linked to another user.
   */
  async linkDiscord(
    userId: number,
    discordId: string,
    username: string,
    avatar?: string,
  ) {
    // Check if Discord account is already linked to another user
    const existingWithDiscord = await this.findByDiscordId(discordId);
    if (existingWithDiscord && existingWithDiscord.id !== userId) {
      throw new ConflictException(
        'This Discord account is already linked to another user',
      );
    }

    // Update user with Discord info
    const [updated] = await this.db
      .update(schema.users)
      .set({
        discordId,
        username, // Update username to Discord username
        avatar,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

    return updated;
  }

  /**
   * Unlink Discord from a user account.
   * Preserves the Discord ID as 'unlinked:<id>' so Discord Login can re-match later.
   */
  async unlinkDiscord(userId: number) {
    const user = await this.findById(userId);
    if (!user || !user.discordId || user.discordId.startsWith('local:')) {
      return user;
    }

    const [updated] = await this.db
      .update(schema.users)
      .set({
        discordId: `unlinked:${user.discordId}`,
        avatar: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

    return updated;
  }

  /**
   * Find a user by Discord ID, including previously unlinked accounts.
   * Checks both raw ID and 'unlinked:<id>' pattern.
   */
  async findByDiscordIdIncludingUnlinked(discordId: string) {
    // First try exact match
    const exact = await this.findByDiscordId(discordId);
    if (exact) return exact;

    // Try unlinked match
    const unlinked = await this.db.query.users.findFirst({
      where: eq(schema.users.discordId, `unlinked:${discordId}`),
    });
    return unlinked ?? null;
  }

  /**
   * Re-link a previously unlinked Discord account.
   * Strips 'unlinked:' prefix and restores Discord info.
   */
  async relinkDiscord(userId: number, username: string, avatar?: string) {
    const user = await this.findById(userId);
    if (!user?.discordId?.startsWith('unlinked:')) return user;

    const rawDiscordId = user.discordId.replace('unlinked:', '');
    const [updated] = await this.db
      .update(schema.users)
      .set({
        discordId: rawDiscordId,
        username,
        avatar,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId))
      .returning();

    return updated;
  }

  /**
   * Count total users in the database.
   * Used for first-run detection (ROK-175 AC-4).
   */
  async count(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users);
    return Number(result[0].count);
  }

  /**
   * Paginated list of all users with optional search.
   * Used for the Players page.
   * ROK-282: Optional gameId filter to show only players who hearted a specific game.
   */
  async findAll(
    page: number,
    limit: number,
    search?: string,
    gameId?: number,
  ): Promise<{
    data: Array<{
      id: number;
      username: string;
      avatar: string | null;
      discordId: string | null;
      customAvatarUrl: string | null;
    }>;
    total: number;
  }> {
    const offset = (page - 1) * limit;

    // If filtering by gameId, get the set of user IDs who hearted that game
    if (gameId) {
      const searchCondition = search
        ? ilike(schema.users.username, `%${search}%`)
        : undefined;

      const baseQuery = this.db
        .select({
          id: schema.users.id,
          username: schema.users.username,
          avatar: schema.users.avatar,
          discordId: schema.users.discordId,
          customAvatarUrl: schema.users.customAvatarUrl,
        })
        .from(schema.gameInterests)
        .innerJoin(
          schema.users,
          eq(schema.gameInterests.userId, schema.users.id),
        )
        .where(
          searchCondition
            ? and(eq(schema.gameInterests.gameId, gameId), searchCondition)
            : eq(schema.gameInterests.gameId, gameId),
        );

      const countQuery = this.db
        .select({ count: sql<number>`count(*)` })
        .from(schema.gameInterests)
        .innerJoin(
          schema.users,
          eq(schema.gameInterests.userId, schema.users.id),
        )
        .where(
          searchCondition
            ? and(eq(schema.gameInterests.gameId, gameId), searchCondition)
            : eq(schema.gameInterests.gameId, gameId),
        );

      const [countResult] = await countQuery;
      const rows = await baseQuery
        .orderBy(asc(schema.users.username))
        .limit(limit)
        .offset(offset);

      return {
        data: rows,
        total: Number(countResult.count),
      };
    }

    const conditions = search
      ? ilike(schema.users.username, `%${search}%`)
      : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.users)
      .where(conditions);

    const rows = await this.db
      .select({
        id: schema.users.id,
        username: schema.users.username,
        avatar: schema.users.avatar,
        discordId: schema.users.discordId,
        customAvatarUrl: schema.users.customAvatarUrl,
      })
      .from(schema.users)
      .where(conditions)
      .orderBy(asc(schema.users.username))
      .limit(limit)
      .offset(offset);

    return {
      data: rows,
      total: Number(countResult.count),
    };
  }

  /**
   * Find users created in the last 30 days, ordered by newest first.
   * Used for the "New Members" highlight on the Players page (ROK-298).
   */
  async findRecent(): Promise<
    Array<{
      id: number;
      username: string;
      avatar: string | null;
      discordId: string | null;
      customAvatarUrl: string | null;
      createdAt: Date;
    }>
  > {
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

  /**
   * ROK-219: Check if a display name is available.
   * Excludes a specific user ID to allow updating own display name.
   */
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

  /**
   * ROK-219: Set a user's display name.
   */
  async setDisplayName(userId: number, displayName: string) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /**
   * ROK-219: Mark onboarding as completed.
   */
  async completeOnboarding(userId: number) {
    const now = new Date();
    const [updated] = await this.db
      .update(schema.users)
      .set({ onboardingCompletedAt: now, updatedAt: now })
      .where(eq(schema.users.id, userId))
      .returning();
    return updated;
  }

  /**
   * ROK-282: Fetch games a user has hearted (game interests).
   * Returns basic game info for display on the public profile.
   */
  async getHeartedGames(userId: number): Promise<
    Array<{
      id: number;
      igdbId: number;
      name: string;
      slug: string;
      coverUrl: string | null;
    }>
  > {
    const rows = await this.db
      .select({
        id: schema.games.id,
        igdbId: schema.games.igdbId,
        name: schema.games.name,
        slug: schema.games.slug,
        coverUrl: schema.games.coverUrl,
      })
      .from(schema.gameInterests)
      .innerJoin(schema.games, eq(schema.gameInterests.gameId, schema.games.id))
      .where(eq(schema.gameInterests.userId, userId))
      .orderBy(asc(schema.games.name));

    return rows;
  }
}
