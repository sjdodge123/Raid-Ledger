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
import { parseDemoBody } from '../../admin/demo-test.utils';
import { ChannelLifecycleAdminService } from './channel-lifecycle-admin.service';
import { ChannelLifecycleScheduler } from './channel-lifecycle.scheduler';

/** `?flag=true|false` (absent → the route's default). */
const BoolQuerySchema = z.enum(['true', 'false']).optional();

/** Parse a boolean query flag; 400 on anything but `true` / `false`. */
function boolQuery(raw: unknown, fallback: boolean): boolean {
  const value = parseDemoBody(BoolQuerySchema, raw);
  return value === undefined ? fallback : value === 'true';
}

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

  /** Run a reconcile now (dry run by default); 409 while one is running. */
  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  reconcile(@Query('dryRun') dryRun: unknown): Promise<ReconcileResultDto> {
    return this.scheduler.reconcileNow(boolQuery(dryRun, true));
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
}
