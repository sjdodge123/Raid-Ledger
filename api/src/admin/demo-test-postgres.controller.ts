import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';

/**
 * DEMO_MODE-only Postgres test fixtures (ROK-1156).
 *
 * Used by smoke tests to register a slow query in `pg_stat_statements`
 * without depending on real production traffic. Mirrors the gating
 * convention from `demo-test-core.controller.ts`.
 */
@Controller('admin/test/postgres')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class DemoTestPostgresController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** Run a 500ms `pg_sleep` so the query crosses the 200ms slow-log threshold. */
  @Post('slow-query')
  @HttpCode(HttpStatus.OK)
  async runSlowQuery(): Promise<{ ranInMs: number }> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new NotFoundException();
    }
    const start = Date.now();
    await this.db.execute(sql`SELECT pg_sleep(0.5)`);
    return { ranInMs: Date.now() - start };
  }
}
