import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { AdminGuard } from '../../../auth/admin.guard';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as links from './hub-forum-discord-links.queries';
import {
  HubForumDiscordSignupPings,
  type SignupPingOutcome,
} from './hub-forum-discord-signup-pings.service';
import { findBoundEventThread } from './hub-forum-discord-signup-pings.queries';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import { findBinding, type ForumDiscordDb } from './hub-forum-discord.queries';

/** What the OQ-9 probe reports — never the token itself. */
export interface WebhookTokenProbe {
  channelId: string;
  webhookId: string | null;
  tokenPresent: boolean;
}

/** What a forced signup-ping flush did, and the post it wrote in. */
export interface SignupPingFlushProbe {
  outcome: SignupPingOutcome;
  /** The event's Discord post, once it exists. */
  discordThreadId: string | null;
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
    private readonly pings: HubForumDiscordSignupPings,
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

  /**
   * ROK-2260 — flush one event's pending signup pings NOW instead of after
   * the ~2 min debounce, so the companion smoke never waits it out.
   */
  @Post('events/:eventId/flush-signup-pings')
  async flushSignupPings(
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<SignupPingFlushProbe> {
    const outcome = await this.pings.flush(eventId);
    const ref = await findBoundEventThread(this.db, eventId);
    const post = ref ? await links.findThreadLink(this.db, ref.threadId) : null;
    return { outcome, discordThreadId: post?.discordThreadId ?? null };
  }
}
