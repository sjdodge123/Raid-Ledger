import { Inject, Injectable } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Service for managing user preferences (ROK-195)
 * Stores key-value preferences like selected avatar, theme, timezone, etc.
 */
@Injectable()
export class PreferencesService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  /**
   * Get a single preference by key for a user
   */
  async getUserPreference(userId: number, key: string) {
    const result = await this.db.query.userPreferences.findFirst({
      where: and(
        eq(schema.userPreferences.userId, userId),
        eq(schema.userPreferences.key, key),
      ),
    });
    return result;
  }

  /**
   * Get all preferences for a user
   */
  async getUserPreferences(userId: number) {
    return this.db.query.userPreferences.findMany({
      where: eq(schema.userPreferences.userId, userId),
    });
  }

  /**
   * Set (upsert) a preference for a user.
   * Uses ON CONFLICT for atomic insert-or-update.
   */
  async setUserPreference(userId: number, key: string, value: unknown) {
    const [result] = await this.db
      .insert(schema.userPreferences)
      .values({
        userId,
        key,
        value,
      })
      .onConflictDoUpdate({
        target: [schema.userPreferences.userId, schema.userPreferences.key],
        set: {
          value,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result;
  }
}
