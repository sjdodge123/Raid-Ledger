/**
 * Notification Dedup Integration Tests (ROK-978)
 *
 * Verifies the database-backed notification dedup guard that survives
 * Redis restarts. Tests cover:
 *   - notification_dedup table existence after migration
 *   - checkAndMarkSent() first-call returns false (not yet sent)
 *   - checkAndMarkSent() Redis fast-path hit returns true
 *   - checkAndMarkSent() DB slow-path after Redis flush returns true
 *   - Expired DB records treated as not-sent (returns false)
 *   - Null TTL (no expiry) for welcome DMs
 *   - Cleanup cron deletes expired rows
 *   - Concurrent dedup race: one caller wins, other is rejected
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { REDIS_CLIENT } from '../redis/redis.module';
import { NotificationDedupService } from './notification-dedup.service';

describe('Notification Dedup (integration)', () => {
  let testApp: TestApp;
  let dedupService: NotificationDedupService;
  let redis: {
    get: (key: string) => Promise<string | null>;
    set: (...args: unknown[]) => Promise<string | null>;
    del: (...keys: string[]) => Promise<number>;
    keys: (pattern: string) => Promise<string[]>;
  };

  beforeAll(async () => {
    testApp = await getTestApp();
    dedupService = testApp.app.get(NotificationDedupService);
    redis = testApp.app.get(REDIS_CLIENT);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    // Clear any Redis keys from previous test
    const keys = await redis.keys('dedup:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  // =================================================================
  // AC: notification_dedup table created with migration
  // =================================================================

  describe('table exists', () => {
    it('should have notification_dedup table queryable after migration', async () => {
      const result = await testApp.db.execute<{ tablename: string }>(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename = 'notification_dedup'
      `);

      expect(result.length).toBe(1);
      expect(result[0].tablename).toBe('notification_dedup');
    });
  });

  // =================================================================
  // AC: Reusable checkAndMarkSent() helper exists
  // AC: Redis remains as fast-path cache layer
  // =================================================================

  describe('checkAndMarkSent()', () => {
    it('should return false on first call (key not in Redis or DB)', async () => {
      // Arrange: fresh key that has never been seen
      const dedupKey = 'recruitment-bump:event:999';
      const ttlSeconds = 48 * 60 * 60; // 48 hours

      // Act
      const result = await dedupService.checkAndMarkSent(
        dedupKey,
        ttlSeconds,
      );

      // Assert: false means "not yet sent, go ahead and send"
      expect(result).toBe(false);

      // Verify side effects: key should now exist in DB
      const dbRows = await testApp.db.execute<{ dedup_key: string }>(sql`
        SELECT dedup_key FROM notification_dedup
        WHERE dedup_key = ${dedupKey}
      `);
      expect(dbRows.length).toBe(1);

      // Verify side effects: key should now exist in Redis
      const redisValue = await redis.get(dedupKey);
      expect(redisValue).not.toBeNull();
    });

    it('should return true on Redis hit without DB query', async () => {
      // Arrange: pre-populate Redis with the key
      const dedupKey = 'recruitment-dm:event:888';
      const ttlSeconds = 48 * 60 * 60;

      // First call: marks as sent
      await dedupService.checkAndMarkSent(dedupKey, ttlSeconds);

      // Act: second call should hit Redis fast-path
      const result = await dedupService.checkAndMarkSent(
        dedupKey,
        ttlSeconds,
      );

      // Assert: true means "already sent, skip"
      expect(result).toBe(true);
    });

    it('should return true on DB hit after Redis flush and re-warm Redis', async () => {
      // Arrange: mark as sent (populates both Redis and DB)
      const dedupKey = 'game-alert:event:777';
      const ttlSeconds = 30 * 24 * 60 * 60; // 30 days

      await dedupService.checkAndMarkSent(dedupKey, ttlSeconds);

      // Simulate Redis restart by clearing all dedup keys
      const keys = await redis.keys('*');
      if (keys.length > 0) await redis.del(...keys);

      // Verify Redis is empty for this key
      const redisValueBefore = await redis.get(dedupKey);
      expect(redisValueBefore).toBeNull();

      // Act: should fall through to DB lookup
      const result = await dedupService.checkAndMarkSent(
        dedupKey,
        ttlSeconds,
      );

      // Assert: true because DB still has the record
      expect(result).toBe(true);

      // Verify Redis was re-warmed
      const redisValueAfter = await redis.get(dedupKey);
      expect(redisValueAfter).not.toBeNull();
    });

    it('should return false when DB record has expired', async () => {
      // Arrange: insert a record directly into DB with expires_at in the past
      const dedupKey = 'recruitment-bump:event:666';

      await testApp.db.execute(sql`
        INSERT INTO notification_dedup (dedup_key, expires_at, created_at)
        VALUES (
          ${dedupKey},
          ${new Date(Date.now() - 60 * 60 * 1000).toISOString()},
          ${new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()}
        )
      `);

      // Act: expired record should be treated as not-sent
      const result = await dedupService.checkAndMarkSent(
        dedupKey,
        48 * 60 * 60,
      );

      // Assert: false means "not yet sent" (expired record is stale)
      expect(result).toBe(false);
    });

    it('should support null TTL (no expiry) for welcome DMs', async () => {
      // Arrange: welcome DM dedup key with no expiry
      const dedupKey = 'discord-notif:welcome:42';

      // Act: pass null TTL to indicate permanent dedup
      const result = await dedupService.checkAndMarkSent(dedupKey, null);

      // Assert: first call returns false
      expect(result).toBe(false);

      // Verify DB record has null expires_at
      const dbRows = await testApp.db.execute<{
        dedup_key: string;
        expires_at: string | null;
      }>(sql`
        SELECT dedup_key, expires_at FROM notification_dedup
        WHERE dedup_key = ${dedupKey}
      `);
      expect(dbRows.length).toBe(1);
      expect(dbRows[0].expires_at).toBeNull();

      // Simulate Redis restart
      const keys = await redis.keys('*');
      if (keys.length > 0) await redis.del(...keys);

      // Second call should still return true (DB has no expiry)
      const resultAfterFlush = await dedupService.checkAndMarkSent(
        dedupKey,
        null,
      );
      expect(resultAfterFlush).toBe(true);
    });
  });

  // =================================================================
  // AC: Expired rows cleaned up by daily cron
  // =================================================================

  describe('cleanup expired dedup rows', () => {
    it('should delete expired rows and preserve non-expired and null-expiry rows', async () => {
      // Arrange: insert mix of expired, valid, and null-expiry rows
      const now = new Date();
      const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const futureDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Expired row (should be deleted)
      await testApp.db.execute(sql`
        INSERT INTO notification_dedup (dedup_key, expires_at, created_at)
        VALUES ('expired-key-1', ${pastDate.toISOString()}, ${pastDate.toISOString()})
      `);

      // Another expired row (should be deleted)
      await testApp.db.execute(sql`
        INSERT INTO notification_dedup (dedup_key, expires_at, created_at)
        VALUES ('expired-key-2', ${pastDate.toISOString()}, ${pastDate.toISOString()})
      `);

      // Non-expired row (should survive)
      await testApp.db.execute(sql`
        INSERT INTO notification_dedup (dedup_key, expires_at, created_at)
        VALUES ('valid-key', ${futureDate.toISOString()}, ${now.toISOString()})
      `);

      // Null-expiry row (should survive -- welcome DM style)
      await testApp.db.execute(sql`
        INSERT INTO notification_dedup (dedup_key, expires_at, created_at)
        VALUES ('permanent-key', NULL, ${now.toISOString()})
      `);

      // Act: run cleanup
      await dedupService.cleanupExpiredDedup();

      // Assert: only non-expired and null-expiry rows remain
      const remaining = await testApp.db.execute<{ dedup_key: string }>(sql`
        SELECT dedup_key FROM notification_dedup ORDER BY dedup_key
      `);

      expect(remaining.length).toBe(2);
      expect(remaining.map((r) => r.dedup_key).sort()).toEqual([
        'permanent-key',
        'valid-key',
      ]);
    });
  });

  // =================================================================
  // AC: Concurrent dedup race -- onConflictDoNothing
  // =================================================================

  describe('concurrent dedup race', () => {
    it('should allow only one caller to win when two race on the same key', async () => {
      // Arrange: same key, simultaneous calls
      const dedupKey = 'recruitment-dm:event:555';
      const ttlSeconds = 48 * 60 * 60;

      // Act: fire two calls concurrently
      const [result1, result2] = await Promise.all([
        dedupService.checkAndMarkSent(dedupKey, ttlSeconds),
        dedupService.checkAndMarkSent(dedupKey, ttlSeconds),
      ]);

      // Assert: exactly one returns false (winner), other returns true (loser)
      const results = [result1, result2].sort();
      expect(results).toEqual([false, true]);

      // Verify only one row in DB
      const dbRows = await testApp.db.execute<{ dedup_key: string }>(sql`
        SELECT dedup_key FROM notification_dedup
        WHERE dedup_key = ${dedupKey}
      `);
      expect(dbRows.length).toBe(1);
    });
  });

  // =================================================================
  // AC: Integration -- flush Redis mid-cycle, verify no re-send
  // =================================================================

  describe('Redis flush mid-cycle resilience', () => {
    it('should not re-send after Redis is flushed because DB guard catches it', async () => {
      // Arrange: simulate a notification cycle marking keys as sent
      const bumpKey = 'recruitment-bump:event:444';
      const dmKey = 'recruitment-dm:event:444';
      const affinityKey = 'game-alert:event:444';
      const welcomeKey = 'discord-notif:welcome:100';
      const ttl48h = 48 * 60 * 60;
      const ttl30d = 30 * 24 * 60 * 60;

      // First cycle: all return false (not yet sent)
      expect(await dedupService.checkAndMarkSent(bumpKey, ttl48h)).toBe(false);
      expect(await dedupService.checkAndMarkSent(dmKey, ttl48h)).toBe(false);
      expect(await dedupService.checkAndMarkSent(affinityKey, ttl30d)).toBe(
        false,
      );
      expect(await dedupService.checkAndMarkSent(welcomeKey, null)).toBe(false);

      // Simulate Redis restart: flush ALL keys
      const allKeys = await redis.keys('*');
      if (allKeys.length > 0) await redis.del(...allKeys);

      // Second cycle after Redis restart: all should return true (DB guard)
      expect(await dedupService.checkAndMarkSent(bumpKey, ttl48h)).toBe(true);
      expect(await dedupService.checkAndMarkSent(dmKey, ttl48h)).toBe(true);
      expect(await dedupService.checkAndMarkSent(affinityKey, ttl30d)).toBe(
        true,
      );
      expect(await dedupService.checkAndMarkSent(welcomeKey, null)).toBe(true);
    });
  });
});
