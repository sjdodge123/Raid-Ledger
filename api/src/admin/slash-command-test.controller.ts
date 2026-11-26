import {
  Controller,
  Delete,
  Inject,
  Param,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { z } from 'zod';
import type Redis from 'ioredis';
import { AdminGuard } from '../auth/admin.guard';
import { isDiscordSnowflake } from '../auth/discord-signin-link.helpers';
import { loginRateLimitKey } from '../discord-bot/commands/login.helpers';
import { signinCodeAttemptKey } from '../discord-bot/commands/login-code.helpers';
import { REDIS_CLIENT } from '../redis/redis.module';
import { DemoModeGuard } from './demo-mode.guard';
import { SlashCommandTestService } from './slash-command-test.service';
import type { CapturedResponse } from './fake-interaction';

const SlashCommandSchema = z.object({
  commandName: z.string().min(1),
  subcommand: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  discordUserId: z.string().optional(),
  guildId: z.string().optional(),
  channelId: z.string().optional(),
});

const AutocompleteSchema = z.object({
  commandName: z.string().min(1),
  focusedOption: z.string().min(1),
  value: z.string(),
  subcommand: z.string().optional(),
  discordUserId: z.string().optional(),
  guildId: z.string().optional(),
});

/**
 * Test-only controller for invoking slash commands via HTTP.
 * DEMO_MODE only — used by smoke tests to validate command handlers
 * without a live Discord interaction.
 */
@Controller('admin/test')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class SlashCommandTestController {
  constructor(
    private readonly service: SlashCommandTestService,
    @Inject(REDIS_CLIENT) private readonly redis: Pick<Redis, 'del'>,
  ) {}

  /**
   * ROK-2283: clear a member's `/login` link counter (3 per 10 minutes), so
   * the companion smoke can re-run against the same env.
   */
  @Delete('login-rate-limit/:discordId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearLoginRateLimit(
    @Param('discordId') discordId: string,
  ): Promise<void> {
    if (!isDiscordSnowflake(discordId)) {
      throw new BadRequestException('discordId must be a Discord snowflake');
    }
    // ROK-2370: and the `/login code:` attempt counter (5 per 10 minutes).
    await this.redis.del(
      loginRateLimitKey(discordId),
      signinCodeAttemptKey(discordId),
    );
  }

  /** Execute a slash command and return the captured response. */
  @Post('slash-command')
  @HttpCode(HttpStatus.OK)
  async executeCommand(@Body() body: unknown): Promise<CapturedResponse> {
    const dto = this.parseBody(SlashCommandSchema, body);
    return this.service.executeCommand({
      commandName: dto.commandName,
      subcommand: dto.subcommand,
      options: dto.options,
      discordUserId: dto.discordUserId,
      guildId: dto.guildId,
      channelId: dto.channelId,
    });
  }

  /** Execute an autocomplete handler and return choices. */
  @Post('slash-command/autocomplete')
  @HttpCode(HttpStatus.OK)
  async executeAutocomplete(
    @Body() body: unknown,
  ): Promise<{ choices: { name: string; value: unknown }[] }> {
    const dto = this.parseBody(AutocompleteSchema, body);
    return this.service.executeAutocomplete({
      commandName: dto.commandName,
      focusedOption: dto.focusedOption,
      value: dto.value,
      subcommand: dto.subcommand,
      discordUserId: dto.discordUserId,
      guildId: dto.guildId,
    });
  }

  /** Parse and validate body with Zod, throwing 400 on failure. */
  private parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
      const messages = result.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      throw new BadRequestException(`Validation failed: ${messages}`);
    }
    return result.data;
  }
}
