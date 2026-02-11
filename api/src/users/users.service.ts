import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq, sql, ilike, asc } from 'drizzle-orm';

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

  async setAdminStatus(discordId: string, isAdmin: boolean) {
    const [updated] = await this.db
      .update(schema.users)
      .set({ isAdmin, updatedAt: new Date() })
      .where(eq(schema.users.discordId, discordId))
      .returning();
    return updated;
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
   */
  async findAll(
    page: number,
    limit: number,
    search?: string,
  ): Promise<{
    data: Array<{ id: number; username: string; avatar: string | null }>;
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
}
