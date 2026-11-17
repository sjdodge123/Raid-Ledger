import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { AdminGuard } from '../../../auth/admin.guard';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import { findBinding, type ForumDiscordDb } from './hub-forum-discord.queries';

/** What the OQ-9 probe reports — never the token itself. */
export interface WebhookTokenProbe {
  channelId: string;
  webhookId: string | null;
  tokenPresent: boolean;
}

/**
 * ROK-2208 OQ-9 — DEMO_MODE probe for the Discord companion smoke: does
 * `fetchWebhooks()` hand Raid Ledger's bot the token of the webhook it made
 * (so nothing is stored)? Answers a boolean; the token never leaves the api.
 */
@Controller('admin/test/hub-forum-discord')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class HubForumDiscordDemoTestController {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordGateway,
  ) {}

  @Get(':guildId/webhook-token')
  async webhookToken(
    @Param('guildId', ParseIntPipe) guildId: number,
  ): Promise<WebhookTokenProbe> {
    const row = await findBinding(this.db, guildId);
    if (!row) throw new NotFoundException('Hub is not linked to a forum');
    const { channelId, webhookId } = row.forum;
    const token = webhookId
      ? await this.gateway.webhookToken(channelId, webhookId)
      : null;
    return { channelId, webhookId, tokenPresent: Boolean(token) };
  }
}
