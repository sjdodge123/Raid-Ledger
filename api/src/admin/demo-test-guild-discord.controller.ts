/**
 * DemoTestGuildDiscordController (ROK-1788 L4) —
 * `POST /admin/test/wow/guild-discord-channel`.
 *
 * Registers (or, with `remove: true`, forgets) a fabricated Discord channel in
 * the guild channel mirror, so the Playwright smoke and the fleet test plan can
 * drive the picker + card without a live bot or a real channel. Binding it to a
 * guild goes through the REAL route (`PUT /plugins/wow/guilds/:id/discord/
 * channel`), which accepts the fabricated id like any bot-readable channel.
 * In-memory only: an API restart forgets every registered channel.
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { ChannelMirrorService } from '../discord-bot/channel-mirror/channel-mirror.service';
import type { ChannelMirrorRead } from '../discord-bot/channel-mirror/channel-mirror.read';
import { parseDemoBody } from './demo-test.utils';
import {
  DEMO_DISCORD_GUILD_ID,
  SeedGuildDiscordChannelSchema,
  buildDemoChannel,
} from './demo-test-guild-discord.helpers';

export type SeedGuildDiscordChannelResult =
  | { channelId: string; removed: boolean }
  | { channelId: string; read: ChannelMirrorRead };

@Controller('admin/test/wow')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestGuildDiscordController {
  constructor(private readonly mirror: ChannelMirrorService) {}

  /** Register / replace / remove one fabricated channel. */
  @Post('guild-discord-channel')
  @HttpCode(HttpStatus.OK)
  seedChannel(@Body() body: unknown): SeedGuildDiscordChannelResult {
    const input = parseDemoBody(SeedGuildDiscordChannelSchema, body);
    if (input.remove === true) {
      const removed = this.mirror.removeDemoChannel(input.channelId);
      return { channelId: input.channelId, removed };
    }
    const discordGuildId =
      this.mirror.discordGuildId() ?? DEMO_DISCORD_GUILD_ID;
    const channel = buildDemoChannel(input, discordGuildId, new Date());
    this.mirror.registerDemoChannel(channel);
    return { channelId: input.channelId, read: channel.read };
  }
}
