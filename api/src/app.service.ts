import { Injectable, Inject } from '@nestjs/common';
import { DrizzleAsyncProvider } from './drizzle/drizzle.module';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './drizzle/schema';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from './redis/redis.module';

@Injectable()
export class AppService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS_CLIENT)
    private redis: Redis,
  ) {}

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
