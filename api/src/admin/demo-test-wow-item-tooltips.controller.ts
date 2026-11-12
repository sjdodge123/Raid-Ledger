/**
 * DemoTestWowItemTooltipsController (ROK-2176) —
 * `POST /admin/test/wow/seed-item-tooltips`
 * `{ items: [{ itemId, tooltip, name?, quality?, icon? }], characterId?, equipment? }`.
 *
 * Seeds fresh `wow_item_meta` tooltip rows (and optionally a character's
 * Armory-shaped gear), then drops the boss-loot Redis cache so the next
 * Boss & Loot read carries the tooltips. DEMO_MODE-only, behind the JWT +
 * admin guards like every `/admin/test/*`. Touches no Discord path.
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
import { BossEncountersService } from '../plugins/wow-common/boss-encounters.service';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import {
  SeedItemTooltipsSchema,
  seedItemTooltips,
  type SeedItemTooltipsResult,
} from './demo-test-wow-item-tooltips.helpers';

@Controller('admin/test/wow')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestWowItemTooltipsController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Store the tooltips (+ gear), then drop the loot cache (WowCommonModule owns it). */
  @Post('seed-item-tooltips')
  @HttpCode(HttpStatus.OK)
  async seedItemTooltips(
    @Body() body: unknown,
  ): Promise<SeedItemTooltipsResult> {
    const input = parseDemoBody(SeedItemTooltipsSchema, body);
    const result = await seedItemTooltips(this.db, input);
    await this.moduleRef
      .get(BossEncountersService, { strict: false })
      .clearCache();
    return result;
  }
}
