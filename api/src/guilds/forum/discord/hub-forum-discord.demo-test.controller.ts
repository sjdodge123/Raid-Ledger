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
import { EventPlanningPostsService } from './event-planning-posts.service';
import { HubForumDiscordEventLockSweep } from './hub-forum-discord-event-lock';
import {
  HubForumDiscordSignupPings,
  type SignupPingOutcome,
} from './hub-forum-discord-signup-pings.service';
import {
  pingPostThreadId,
  resolvePingThread,
} from './hub-forum-discord-signup-pings.target';
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
    private readonly planning: EventPlanningPostsService,
    private readonly lockSweep: HubForumDiscordEventLockSweep,
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
   * the ~2 min debounce, so the companion smoke never waits it out. Also
   * reports a non-hub event's Discord-only post (ROK-2272 S4b).
   */
  @Post('events/:eventId/flush-signup-pings')
  async flushSignupPings(
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<SignupPingFlushProbe> {
    const outcome = await this.pings.flush(eventId);
    const ref = await resolvePingThread(this.db, eventId);
    const discordThreadId = await pingPostThreadId(this.db, ref);
    return { outcome, discordThreadId };
  }

  /**
   * ROK-2272 S4b — re-sync a non-hub event's planning post (closes_at +
   * title) the way a real edit's `APP_EVENT_EVENTS.UPDATED` does. The
   * `set-event-times` fixture writes the row directly and emits nothing, and
   * making it emit would fire every other UPDATED listener in other smokes.
   */
  @Post('events/:eventId/sync-planning-post')
  async syncPlanningPost(
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<{ synced: true }> {
    await this.planning.syncEvent(eventId);
    return { synced: true };
  }

  /**
   * ROK-2272 S4b — run the Core event lock sweep NOW (hub + planning posts)
   * instead of waiting for the 5-minute cron. Always the real current time:
   * a caller-supplied future "now" would close other runs' live posts.
   */
  @Post('lock-sweep')
  async lockSweepNow(): Promise<{ changed: number }> {
    const changed = await this.lockSweep.sweep();
    return { changed };
  }
}
