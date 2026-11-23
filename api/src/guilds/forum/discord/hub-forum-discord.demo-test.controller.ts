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
import { eq } from 'drizzle-orm';
import { SkipThrottle } from '@nestjs/throttler';
import { DemoModeGuard } from '../../../admin/demo-mode.guard';
import { AdminGuard } from '../../../auth/admin.guard';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  findLivePlanningPost,
  setPlanningPostClosesAt,
} from './event-planning-posts.queries';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
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
    private readonly subjects: EventPlanningSubjectPosts,
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

  /**
   * ROK-2272 S8 — close a poll thread's Discord write window NOW: its
   * `write_closes_at` goes to 1 s in the past, so the next `lock-sweep`
   * locks + archives the poll's Discord post. The real window ends an hour
   * after the poll does, which no smoke can wait out.
   */
  @Post('polls/:matchId/close-discussion-now')
  async closeDiscussionNow(
    @Param('matchId', ParseIntPipe) matchId: number,
  ): Promise<{ closed: number }> {
    const t = schema.hubForumThreads;
    const rows = await this.db
      .update(t)
      .set({ writeClosesAt: new Date(Date.now() - 1000) })
      .where(eq(t.matchId, matchId))
      .returning({ id: t.id });
    if (rows.length === 0) throw new NotFoundException('Poll has no thread');
    return { closed: rows.length };
  }

  /**
   * ROK-2272 S10 — re-sync a NON-hub poll's registry planning post the way a
   * poll emit does (never creates one). Real time only.
   */
  @Post('polls/:matchId/sync-planning-post')
  async syncPollPlanningPost(
    @Param('matchId', ParseIntPipe) matchId: number,
  ): Promise<{ synced: true }> {
    await this.subjects.syncPoll(matchId, new Date());
    return { synced: true };
  }

  /**
   * ROK-2272 S10 — close a non-hub poll's planning post NOW: its `closes_at`
   * goes to 1 s in the past, so the next `lock-sweep` locks + archives it.
   * The real close is an hour after the poll ends, which no smoke can wait.
   */
  @Post('polls/:matchId/close-planning-post-now')
  async closePlanningPostNow(
    @Param('matchId', ParseIntPipe) matchId: number,
  ): Promise<{ postId: number }> {
    const post = await findLivePlanningPost(this.db, 'poll', matchId);
    if (!post) throw new NotFoundException('Poll has no planning post');
    await setPlanningPostClosesAt(
      this.db,
      post.id,
      new Date(Date.now() - 1000),
    );
    return { postId: post.id };
  }
}
