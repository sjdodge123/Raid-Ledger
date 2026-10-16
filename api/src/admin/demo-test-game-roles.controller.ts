/**
 * ROK-1767 — DEMO_MODE fixtures for the game-role companion-bot smoke.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Guild } from 'discord.js';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { addMemberRole } from '../discord-bot/game-roles/game-role-discord.helpers';
import type { GameRoleDb } from '../discord-bot/game-roles/game-role-reconcile.helpers';
import {
  readMemberRoles,
  seedGameSession,
  sweepSmokeRoles,
} from './demo-test-game-roles.helpers';

const Snowflake = z.string().regex(/^\d{5,25}$/);
const SeedSchema = z.object({
  discordUserId: Snowflake,
  gameId: z.number().int().positive(),
  startedAtDaysAgo: z.number().min(0).max(365),
});
const HandAssignSchema = z.object({
  discordUserId: Snowflake,
  roleId: Snowflake,
});
const SweepSchema = z.object({ name: z.string().min(1).optional() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues);
  return r.data;
}

@Controller('admin/test/game-roles')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestGameRolesController {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: GameRoleDb,
    private readonly botClient: DiscordBotClientService,
  ) {}

  private guild(): Guild {
    const guild = this.botClient.getGuild();
    if (!guild) throw new ServiceUnavailableException('Bot is not connected');
    return guild;
  }

  /** Replace the member's presence for a game with one session N days ago. */
  @Post('seed-session')
  @HttpCode(HttpStatus.OK)
  seedSession(
    @Body() body: unknown,
  ): Promise<{ userId: number; voicePlays: number }> {
    const dto = parse(SeedSchema, body);
    return seedGameSession(this.db, {
      discordUserId: dto.discordUserId,
      gameId: dto.gameId,
      daysAgo: dto.startedAtDaysAgo,
    });
  }

  /** The member's current role ids, read through the API bot. */
  @Get('member-roles')
  async memberRoles(
    @Query('discordUserId') discordUserId: string,
  ): Promise<{ roleIds: string[] }> {
    const id = parse(Snowflake, discordUserId);
    const roleIds = await readMemberRoles(this.guild(), id);
    if (roleIds === null) throw new NotFoundException('Not a guild member');
    return { roleIds };
  }

  /** Give a role by hand — no grant row, so the bot must never remove it. */
  @Post('hand-assign')
  @HttpCode(HttpStatus.OK)
  async handAssign(@Body() body: unknown): Promise<{ ok: boolean }> {
    const dto = parse(HandAssignSchema, body);
    const ok = await addMemberRole(
      this.guild(),
      dto.discordUserId,
      dto.roleId,
      'Raid Ledger smoke: hand-assigned',
    );
    return { ok };
  }

  /** Delete `smoke-gr-*` roles (one by name, or the stale ones). */
  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  async sweep(@Body() body: unknown): Promise<{ deleted: number }> {
    const { name } = parse(SweepSchema, body);
    return { deleted: await sweepSmokeRoles(this.db, this.guild(), name) };
  }
}
