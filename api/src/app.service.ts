import {
  Injectable,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DrizzleAsyncProvider } from './drizzle/drizzle.module';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './drizzle/schema';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis/redis.module';

@Injectable()
export class AppService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ROK-777-Audit');

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT)
    private redis: Redis,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // ROK-777: One-time diagnostic — remove after collecting prod data
    await this.logWowClassicAudit();
  }

  /** ROK-777: Diagnostic logging for WoW Classic variant migration planning */
  private async logWowClassicAudit(): Promise<void> {
    try {
      const results = await this.db.execute(sql`
        WITH wow_game AS (
          SELECT id, slug, name, hidden
          FROM games
          WHERE slug LIKE 'world-of-warcraft-classic%'
             OR slug LIKE 'world-of-warcraft%burning%'
             OR slug LIKE 'world-of-warcraft%wrath%'
             OR slug LIKE 'world-of-warcraft%cataclysm%'
             OR slug LIKE 'world-of-warcraft%mists%'
             OR slug LIKE 'world-of-warcraft%season-of-discovery%'
        ),
        char_counts AS (
          SELECT
            c.game_id,
            c.game_variant,
            COUNT(*) AS cnt
          FROM characters c
          INNER JOIN wow_game g ON g.id = c.game_id
          GROUP BY c.game_id, c.game_variant
        ),
        event_counts AS (
          SELECT
            e.game_id,
            COUNT(*) AS cnt
          FROM events e
          INNER JOIN wow_game g ON g.id = e.game_id
          GROUP BY e.game_id
        ),
        interest_counts AS (
          SELECT
            gi.game_id,
            COUNT(*) AS cnt
          FROM game_interests gi
          INNER JOIN wow_game g ON g.id = gi.game_id
          GROUP BY gi.game_id
        ),
        session_counts AS (
          SELECT
            gas.game_id,
            COUNT(*) AS cnt,
            SUM(duration_seconds) AS total_seconds
          FROM game_activity_sessions gas
          INNER JOIN wow_game g ON g.id = gas.game_id
          GROUP BY gas.game_id
        ),
        rollup_counts AS (
          SELECT
            gar.game_id,
            COUNT(*) AS cnt,
            SUM(total_seconds) AS total_seconds
          FROM game_activity_rollups gar
          INNER JOIN wow_game g ON g.id = gar.game_id
          GROUP BY gar.game_id
        )
        SELECT json_build_object(
          'games', (SELECT json_agg(row_to_json(wow_game)) FROM wow_game),
          'characters', (SELECT json_agg(row_to_json(char_counts)) FROM char_counts),
          'events', (SELECT json_agg(row_to_json(event_counts)) FROM event_counts),
          'interests', (SELECT json_agg(row_to_json(interest_counts)) FROM interest_counts),
          'sessions', (SELECT json_agg(row_to_json(session_counts)) FROM session_counts),
          'rollups', (SELECT json_agg(row_to_json(rollup_counts)) FROM rollup_counts)
        ) AS audit
      `);

      const audit = results[0]?.audit;
      this.logger.warn(
        `WoW Classic data audit:\n${JSON.stringify(audit, null, 2)}`,
      );
    } catch (err) {
      this.logger.error('WoW Classic audit failed', err);
    }
  }

  getHello(): string {
    return 'Hello World!';
  }

  async checkDatabaseHealth(): Promise<{
    connected: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await this.db.execute(sql`SELECT 1`);
      return { connected: true, latencyMs: Date.now() - start };
    } catch {
      return { connected: false, latencyMs: Date.now() - start };
    }
  }

  async checkRedisHealth(): Promise<{
    connected: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await this.redis.ping();
      return { connected: true, latencyMs: Date.now() - start };
    } catch {
      return { connected: false, latencyMs: Date.now() - start };
    }
  }
}
