import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import type {
  ChannelLifecycleSettingsDto,
  GameLifecycleActivityListDto,
  LifecycleSuppressionListDto,
  ReconcileResultDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import { DemoModeGuard } from '../../admin/demo-mode.guard';
import { parseDemoBody } from '../../admin/demo-test.utils';
import { SettingsService } from '../../settings/settings.service';
import { ChannelLifecycleAdminService } from './channel-lifecycle-admin.service';
import { ChannelLifecycleScheduler } from './channel-lifecycle.scheduler';

/** `?flag=true|false` (absent → the route's default). */
const BoolQuerySchema = z.enum(['true', 'false']).optional();

/** Parse a boolean query flag; 400 on anything but `true` / `false`. */
function boolQuery(raw: unknown, fallback: boolean): boolean {
  const value = parseDemoBody(BoolQuerySchema, raw);
  return value === undefined ? fallback : value === 'true';
}

/** Postgres `integer` ceiling — a larger id can never match a game. */
const MAX_INT4 = 2_147_483_647;

/** `?gameIds=1,2,3` — comma-separated positive ints, no blanks. */
const GameIdsQuerySchema = z
  .string()
  .regex(/^\d+(,\d+)*$/, 'must be comma-separated positive integers')
  .transform((raw) => raw.split(',').map(Number))
  .pipe(z.array(z.number().int().positive().max(MAX_INT4)).min(1));

/**
 * ROK-1432 — admin routes for channel lifecycle automation (spec ROK-1428
 * §2.3). Every route is `jwt + AdminGuard`.
 */
@Controller('admin/discord/lifecycle')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class ChannelLifecycleAdminController {
  constructor(
    private readonly admin: ChannelLifecycleAdminService,
    private readonly scheduler: ChannelLifecycleScheduler,
    private readonly settings: SettingsService,
  ) {}

  /** Current lifecycle settings. */
  @Get('settings')
  getSettings(): Promise<ChannelLifecycleSettingsDto> {
    return this.admin.getSettings();
  }

  /** Partial update; enabling resolves the categories first (400 if it cannot). */
  @Patch('settings')
  @HttpCode(HttpStatus.OK)
  updateSettings(@Body() body: unknown): Promise<ChannelLifecycleSettingsDto> {
    return this.admin.updateSettings(body);
  }

  /** Per-game derived activity + the decision the reconciler would make. */
  @Get('activity')
  activity(@Query('all') all: unknown): Promise<GameLifecycleActivityListDto> {
    return this.admin.activity(boolQuery(all, false));
  }

  /**
   * Run a reconcile now (dry run by default); 409 while one is running.
   * `?gameIds=1,2` limits the run to those games — DEMO_MODE only (403
   * otherwise, 400 when malformed), so a fleet env can do a live run on its
   * seeded games without touching every demo game in a shared guild.
   */
  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Query('dryRun') dryRun: unknown,
    @Query('gameIds') gameIds: unknown,
  ): Promise<ReconcileResultDto> {
    const dry = boolQuery(dryRun, true);
    const ids = await this.demoGameIds(gameIds);
    return this.scheduler.reconcileNow(dry, ids);
  }

  /** Games whose managed channel was hand-deleted or unbound. */
  @Get('suppressions')
  suppressions(): Promise<LifecycleSuppressionListDto> {
    return this.admin.suppressions();
  }

  /** "Recreate": clear a suppression (204) — 404 when there is none. */
  @Delete('suppressions/:gameId')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearSuppression(
    @Param('gameId', ParseIntPipe) gameId: number,
  ): Promise<void> {
    return this.admin.clearSuppression(gameId);
  }

  /**
   * The `gameIds` filter, or undefined when absent. Present ⇒ the same
   * DEMO_MODE gate (env + DB setting, same 403) as every `/admin/test/*`
   * route, then a strict parse (400).
   */
  private async demoGameIds(raw: unknown): Promise<number[] | undefined> {
    if (raw === undefined) return undefined;
    await new DemoModeGuard(this.settings).canActivate();
    return parseDemoBody(GameIdsQuerySchema, raw);
  }
}
