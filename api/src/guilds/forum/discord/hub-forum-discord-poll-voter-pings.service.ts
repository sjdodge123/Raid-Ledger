/**
 * ROK-2272 S10 (R5) — a poll voter's first committed vote pings them once
 * into the poll's Discord post. Two disjoint arms: a HUB poll (live hub
 * thread, `guildId !== null`) pings in its hub thread's post — and the vote
 * still creates that post, as S8's first-vote path did; a NON-HUB poll pings
 * in its registry post (created on the vote by `EventPlanningSubjectPosts`).
 * A cleared tap, an unlinked user, a locked / deleted / unsent post or an
 * offline bot pings nothing; only a claimed once-key sends, and a failed
 * send releases it. Lineups get no pings. A send that finds the Discord
 * post gone (10003 / 404 — deleted while the bot missed the inbound delete)
 * marks it deleted on either arm, so later votes stop claiming and failing.
 *
 * ROK-2295 lane C: the one line lists the voter's slots read at send time
 * and its message id is stored (`PollVoterLines`), so later votes edit it.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type { PollVotedPayload } from '../../../lineups/lineup-events.constants';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { findLivePollThread } from '../subject-discussion/poll-discussion.queries';
import { markPlanningPostDeleted } from './event-planning-posts.queries';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { isUnsent, markDeleted } from './hub-forum-discord-links.queries';
import {
  HubForumDiscordOutboundGateway,
  isGone,
} from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import {
  linkedDiscordId,
  VOTER_ONCE_TTL_SECONDS,
  voterOnceKey,
  voterLine,
  voterScopeKey,
  type VoterPingOutcome,
  type VoterPingScope,
} from './hub-forum-discord-poll-voter-pings';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import { PollVoterLines } from './poll-voter-lines.refresh';

@Injectable()
export class HubForumDiscordPollVoterPings {
  private readonly logger = new Logger(HubForumDiscordPollVoterPings.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly outbound: HubForumDiscordOutboundService,
    private readonly subjects: EventPlanningSubjectPosts,
    private readonly gateway: HubForumDiscordOutboundGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly lines: PollVoterLines,
  ) {}

  /**
   * Hub arm. Any POLL_VOTED creates the hub post (S8 behaviour, kept for
   * cleared taps too); only a committed vote pings. An unsent post neither
   * pings nor claims — the voter's next vote pings (plan A3).
   */
  async hubVote(p: PollVotedPayload): Promise<VoterPingOutcome> {
    const thread = await findLivePollThread(this.db, p.matchId);
    if (!thread) return 'no-post';
    const post = await this.outbound.ensureEventPost({
      guildId: thread.guildId,
      threadId: thread.id,
    });
    if (p.stance === null) return 'cleared';
    if (!post) return 'no-post';
    if (post.discordDeletedAt !== null || post.discordLockedAt !== null) {
      return 'closed-post';
    }
    if (isUnsent(post)) return 'pending';
    const scope = { hubThreadId: thread.id };
    const gone = () => markDeleted(this.db, post.id, new Date());
    return this.ping(scope, post.discordThreadId, p, gone);
  }

  /** Non-hub arm: the registry post (created by this vote when eligible). */
  async planningVote(p: PollVotedPayload): Promise<VoterPingOutcome> {
    if (p.stance === null) return 'cleared';
    const ref = await this.subjects.ensurePollPost(p.matchId);
    if (!ref) return 'no-post';
    // A poll hub-tagged or made private after its post exists pings nowhere
    // here (the hub arm owns a hub-tagged poll's ping).
    const row = await this.subjects.livePollPostOnPath(p.matchId);
    if (!row) return 'no-post';
    if (row.id !== ref.postId || row.discordLockedAt !== null) {
      return 'closed-post';
    }
    const scope = { planningPostId: ref.postId };
    const gone = () => markPlanningPostDeleted(this.db, ref.postId, new Date());
    return this.ping(scope, ref.discordThreadId, p, gone);
  }

  private async ping(
    scope: VoterPingScope,
    discordThreadId: string,
    { matchId, userId }: PollVotedPayload,
    markGone: () => Promise<void>,
  ): Promise<VoterPingOutcome> {
    const discordId = await this.discordIdOf(userId);
    if (discordId === null) return 'unlinked';
    if (!this.gateway.isOnline()) return 'offline';
    const key = voterOnceKey(scope, userId);
    const ttl = VOTER_ONCE_TTL_SECONDS;
    const claimed = await this.redis.set(key, '1', 'EX', ttl, 'NX');
    if (claimed === null) return 'already';
    try {
      const slots = await this.lines.slotsOf(matchId, userId);
      const line = voterLine(discordId, slots);
      const ids = [discordId];
      const messageId = await this.gateway.mention(discordThreadId, line, ids);
      await this.lines.store(discordThreadId, userId, {
        messageId,
        discordId,
        slots,
      });
      return 'pinged';
    } catch (err) {
      await this.redis.del(key);
      if (isGone(err)) await markGone();
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Voter ping for user ${userId} in ${voterScopeKey(scope)} lost: ${why}`,
      );
      return 'send-failed';
    }
  }

  private async discordIdOf(userId: number): Promise<string | null> {
    const u = schema.users;
    const [row] = await this.db
      .select({ discordId: u.discordId })
      .from(u)
      .where(eq(u.id, userId))
      .limit(1);
    return linkedDiscordId(row?.discordId ?? null);
  }
}
