import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import * as schema from '../drizzle/schema';

/**
 * Database-backed notification dedup guard (ROK-978).
 *
 * Prevents duplicate notifications by combining a Redis fast-path cache
 * with PostgreSQL persistence. Redis is checked first for speed; on miss
 * the DB is consulted. This survives Redis restarts (e.g. daily at 5 AM).
 *
 * Rate limits and failure counters remain Redis-only.
 */
@Injectable()
export class NotificationDedupService {
  private readonly logger = new Logger(NotificationDedupService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT)
    private redis: Redis,
  ) {}

  /**
   * Check whether a notification has already been sent for the given key.
   * If not yet sent, atomically marks it as sent in both Redis and DB.
   *
   * @param dedupKey - Unique key identifying the notification (e.g. "recruitment-bump:event:42")
   * @param ttlSeconds - TTL in seconds, or null for permanent dedup (e.g. welcome DMs)
   * @returns false if not yet sent (caller should send), true if already sent (caller should skip)
   */
  async checkAndMarkSent(
    dedupKey: string,
    ttlSeconds: number | null,
  ): Promise<boolean> {
    // Fast-path: check Redis first
    const cached = await this.redis.get(dedupKey);
    if (cached) return true;

    // Slow-path: check DB
    const dbHit = await this.findValidDbRecord(dedupKey);
    if (dbHit) {
      await this.warmRedisCache(dedupKey, ttlSeconds);
      return true;
    }

    // Not sent yet — attempt atomic insert
    return this.attemptInsert(dedupKey, ttlSeconds);
  }

  /**
   * Delete all expired dedup rows from the database.
   * Rows with null expires_at are permanent and never cleaned up.
   */
  async cleanupExpiredDedup(): Promise<void> {
    const result = await this.db.execute<{ count: string }>(sql`
      DELETE FROM notification_dedup
      WHERE expires_at IS NOT NULL AND expires_at < NOW()
    `);
    const count = result.length;
    if (count > 0) {
      this.logger.log(`Cleaned up expired notification dedup rows`);
    }
  }

  /** Check if a non-expired DB record exists for the given dedup key. */
  private async findValidDbRecord(dedupKey: string): Promise<boolean> {
    const rows = await this.db.execute<{ id: number }>(sql`
      SELECT id FROM notification_dedup
      WHERE dedup_key = ${dedupKey}
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `);
    return rows.length > 0;
  }

  /** Re-populate Redis from DB to avoid future DB lookups. */
  private async warmRedisCache(
    dedupKey: string,
    ttlSeconds: number | null,
  ): Promise<void> {
    if (ttlSeconds != null) {
      await this.redis.set(dedupKey, '1', 'EX', ttlSeconds);
    } else {
      await this.redis.set(dedupKey, '1');
    }
  }

  /**
   * Attempt to insert a new dedup record. Removes any expired row first,
   * then uses ON CONFLICT DO NOTHING for concurrent race safety.
   *
   * @returns false if insert succeeded (not previously sent), true if conflict (already sent)
   */
  private async attemptInsert(
    dedupKey: string,
    ttlSeconds: number | null,
  ): Promise<boolean> {
    // Remove stale expired row so the fresh insert can succeed
    await this.db.execute(sql`
      DELETE FROM notification_dedup
      WHERE dedup_key = ${dedupKey}
        AND expires_at IS NOT NULL
        AND expires_at < NOW()
    `);

    const expiresAt =
      ttlSeconds != null
        ? new Date(Date.now() + ttlSeconds * 1000).toISOString()
        : null;

    const result = await this.db.execute<{ id: number }>(sql`
      INSERT INTO notification_dedup (dedup_key, expires_at)
      VALUES (${dedupKey}, ${expiresAt})
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id
    `);

    if (result.length > 0) {
      // Insert succeeded — we are the winner
      await this.warmRedisCache(dedupKey, ttlSeconds);
      return false;
    }

    // Conflict — another caller already inserted
    return true;
  }
}
