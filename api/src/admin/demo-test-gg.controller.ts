/**
 * DemoTestGgController (ROK-2187) — GG <year> delivery fixtures for smoke and
 * the fleet test plan. DEMO_MODE-only, behind the JWT + admin guards.
 *
 * - `POST /admin/test/gg/reset {year}` releases the year's announce key and
 *   clears every DM claim/stamp, so send-now announces again.
 * - `POST /admin/test/gg/age-announce {year, minutes}` backdates the announce
 *   by `minutes`, so the DM wave opens without waiting out the offset.
 * - `POST /admin/test/gg/seed {userId, year, snapshot?}` stores a snapshot:
 *   the given one, else the user's live compute (422 without activity).
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { GgSnapshotV1Schema, GgYearSchema } from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { notificationDedup } from '../drizzle/schema';
import { parseDemoBody } from './demo-test.utils';
import { NotificationDedupService } from '../notifications/notification-dedup.service';
import { GgComputeService } from '../plugins/core/gg/gg-compute.service';
import { ggAnnounceKey } from '../plugins/core/gg/gg-delivery.schedule';
import { resetGgDmState } from '../plugins/core/gg/gg-dm-wave.helpers';

const YearBody = z.object({ year: GgYearSchema });
const AgeBody = z.object({
  year: GgYearSchema,
  minutes: z.number().int().min(0).max(10_080),
});
const SeedBody = z.object({
  userId: z.number().int().positive(),
  year: GgYearSchema,
  snapshot: GgSnapshotV1Schema.optional(),
});

@Controller('admin/test/gg')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestGgController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly dedup: NotificationDedupService,
    private readonly compute: GgComputeService,
  ) {}

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async reset(@Body() body: unknown): Promise<{ year: number; rows: number }> {
    const { year } = parseDemoBody(YearBody, body);
    await this.dedup.releaseKey(ggAnnounceKey(year));
    return { year, rows: await resetGgDmState(this.db, year) };
  }

  @Post('age-announce')
  @HttpCode(HttpStatus.OK)
  async ageAnnounce(@Body() body: unknown): Promise<{ aged: number }> {
    const { year, minutes } = parseDemoBody(AgeBody, body);
    const rows = await this.db
      .update(notificationDedup)
      .set({
        createdAt: sql`${notificationDedup.createdAt} - make_interval(mins => ${minutes})`,
      })
      .where(eq(notificationDedup.dedupKey, ggAnnounceKey(year)))
      .returning({ id: notificationDedup.id });
    return { aged: rows.length };
  }

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(@Body() body: unknown): Promise<{ userId: number; year: number }> {
    const input = parseDemoBody(SeedBody, body);
    const snapshot =
      input.snapshot ??
      (await this.compute.computeForUser(input.userId, input.year));
    if (!snapshot || snapshot.year !== input.year) {
      throw new UnprocessableEntityException(
        `No GG ${input.year} snapshot for user ${input.userId}`,
      );
    }
    await this.compute.upsertSnapshot(input.userId, snapshot);
    return { userId: input.userId, year: input.year };
  }
}
