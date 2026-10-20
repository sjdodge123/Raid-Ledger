/**
 * DemoTestChannelLifecycleController (ROK-1432 L6b, ROK-1428 §2.10).
 *
 * `POST /admin/test/channel-lifecycle/seed` — one game (idempotent per
 * `gameName`) with the requested activity items, binding, suppression and
 * server hub. `POST /admin/test/channel-lifecycle/age-binding` — shifts a
 * binding's `archived_at`/`created_at` and its game's activity back.
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/types';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelBindingsService } from '../discord-bot/services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { DemoModeGuard } from './demo-mode.guard';
import { parseDemoBody } from './demo-test.utils';
import {
  AgeBindingSchema,
  ChannelLifecycleSeedSchema,
  ageBinding,
  ensureSeedGame,
  seedEvents,
  type ChannelLifecycleSeedInput,
} from './demo-test-channel-lifecycle.helpers';
import {
  seedBinding,
  seedEventPlans,
  seedLineupVotes,
  seedPolls,
  seedServerHubWithoutChannel,
  seedSuppression,
} from './demo-test-channel-lifecycle.seed';

/** Used when the bot is offline (no connected guild). */
const OFFLINE_GUILD_ID = 'demo-lifecycle-guild';
const NOTE =
  'channelId is a fake snowflake: no real Discord channel exists for it on a fleet env.';

export interface ChannelLifecycleSeedResult {
  gameId: number;
  gameName: string;
  guildId: string;
  eventIds: number[];
  pollId: number | null;
  eventPlanId: string | null;
  lineupId: number | null;
  bindingId: string | null;
  channelId: string | null;
  hubId: number | null;
  note: string;
}

@Controller('admin/test/channel-lifecycle')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestChannelLifecycleController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly bindings: ChannelBindingsService,
    private readonly client: DiscordBotClientService,
  ) {}

  /** Seed one game's lifecycle scenario; returns every id (null = not seeded). */
  @Post('seed')
  @HttpCode(HttpStatus.OK)
  async seed(
    @Body() body: unknown,
    @Request() req: AuthenticatedRequest,
  ): Promise<ChannelLifecycleSeedResult> {
    const input = parseDemoBody(ChannelLifecycleSeedSchema, body);
    const game = await ensureSeedGame(this.db, input.gameName);
    const guildId = this.client.getGuildId() ?? OFFLINE_GUILD_ID;
    const ctx = { gameId: game.id, creatorId: req.user.id, now: new Date() };
    const ids = await this.seedItems(ctx, input.items);
    const ref = { guildId, gameId: game.id, now: ctx.now };
    const bound = await seedBinding(this.db, this.bindings, ref, input.binding);
    await seedSuppression(this.db, ref, input.suppression);
    const hubId = input.serverHubWithoutChannel
      ? await seedServerHubWithoutChannel(this.db, game)
      : null;
    return {
      gameId: game.id,
      gameName: game.name,
      guildId,
      ...ids,
      bindingId: bound?.bindingId ?? null,
      channelId: bound?.channelId ?? null,
      hubId,
      note: NOTE,
    };
  }

  /** Shift a binding + its game's activity `daysAgo` days into the past. */
  @Post('age-binding')
  @HttpCode(HttpStatus.OK)
  async ageBinding(@Body() body: unknown): Promise<{
    bindingId: string;
    gameId: number | null;
    shiftedDays: number;
  }> {
    return ageBinding(this.db, parseDemoBody(AgeBindingSchema, body));
  }

  private async seedItems(
    ctx: { gameId: number; creatorId: number; now: Date },
    items: ChannelLifecycleSeedInput['items'],
  ): Promise<
    Pick<
      ChannelLifecycleSeedResult,
      'eventIds' | 'pollId' | 'eventPlanId' | 'lineupId'
    >
  > {
    return {
      eventIds: await seedEvents(this.db, ctx, items.events, items.adHocEvents),
      pollId: await seedPolls(this.db, ctx, items.polls),
      eventPlanId: await seedEventPlans(this.db, ctx, items.eventPlans),
      lineupId: await seedLineupVotes(this.db, ctx, items.lineupVotes),
    };
  }
}
