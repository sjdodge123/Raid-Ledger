/**
 * DemoTestAttunementsController (ROK-1927 P6) —
 * `POST /admin/test/wow/seed-attunements`
 * `{ characters?: { done, inProgress, notStarted }, cast?: [{ characterId,
 * attunement, completedSteps, questLog?, questLogCapturedAt?, completedAt?,
 * faction?, level? }] }` (character uuids, e.g. a `seed-guild` cast's gm /
 * officer / member; at least one of the two).
 *
 * Confirms the Horde Onyxia attunement chain and gives the three characters
 * Armory quest lists (see `demo-test-attunements.helpers.ts`), then drops the
 * roster-insights cache of each character's guilds so the next read carries
 * them.
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { RosterInsightsCache } from '../plugins/wow-common/guilds/roster-insights/roster-insights.cache';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import {
  SeedAttunementsSchema,
  seedAttunements,
  seededCharacterIds,
  type SeedAttunementsResult,
} from './demo-test-attunements.helpers';

@Controller('admin/test/wow')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestAttunementsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Seed the cast's quests, then drop the insights cache (WowCommonModule owns it). */
  @Post('seed-attunements')
  @HttpCode(HttpStatus.OK)
  async seedAttunements(@Body() body: unknown): Promise<SeedAttunementsResult> {
    const input = parseDemoBody(SeedAttunementsSchema, body);
    const result = await seedAttunements(this.db, input, new Date());
    const cache = this.moduleRef.get(RosterInsightsCache, { strict: false });
    for (const id of seededCharacterIds(input)) {
      await cache.invalidateForCharacter(id);
    }
    return result;
  }
}
