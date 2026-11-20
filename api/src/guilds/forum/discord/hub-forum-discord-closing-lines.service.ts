/**
 * ROK-2272 S8 — the poll / lineup lifecycle in a hub thread's Discord post:
 * a poll's first vote creates the post; a lock-in, cancel, decide or abort
 * posts ONE closing bot line into the post that already exists (Discord
 * only — the RL page shows the end state itself). Never creates a post just
 * to close it, once per subject end. A reopen forgets the end's once-key so
 * the next end posts again. Best-effort: a failed send is logged and the
 * line is lost (nothing re-emits an end); it never throws into the listener.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import { findLiveLineupThread } from '../subject-discussion/lineup-discussion.queries';
import {
  findLivePollThread,
  findPollForSync,
} from '../subject-discussion/poll-discussion.queries';
import {
  closingLineText,
  type ClosingLine,
} from './hub-forum-discord-closing-lines';
import { findThreadLink, isUnsent } from './hub-forum-discord-links.queries';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/** A claimed once-key outlives any subject's end by far. */
export const CLOSING_ONCE_TTL_SECONDS = 30 * 24 * 3600;

/** Redis key that lets exactly one caller post a thread's closing line. */
export function closingOnceKey(threadId: number, onceKey: string): string {
  return `hfd:closing:${threadId}:${onceKey}`;
}

/** Once-keys that a reopen clears (lock-in keys on its event id instead). */
export const POLL_END_KEYS = ['cancelled'] as const;
export const LINEUP_END_KEYS = ['decided', 'aborted'] as const;

/** Why a closing line did or did not go out. */
export type ClosingOutcome =
  'posted' | 'no-post' | 'closed-post' | 'offline' | 'already' | 'send-failed';

@Injectable()
export class HubForumDiscordClosingLines {
  private readonly logger = new Logger(HubForumDiscordClosingLines.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly outbound: HubForumDiscordOutboundService,
    private readonly gateway: HubForumDiscordOutboundGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly settings: SettingsService,
  ) {}

  /** R4: a poll's first vote creates its hub thread's Discord post. */
  async firstVote(matchId: number): Promise<void> {
    const thread = await findLivePollThread(this.db, matchId);
    if (!thread) return;
    await this.outbound.ensureEventPost({
      guildId: thread.guildId,
      threadId: thread.id,
    });
  }

  /** A poll locked in: the event line. An eventless lock-in posts nothing. */
  async pollLockedIn(matchId: number, eventId: number | null): Promise<void> {
    if (eventId === null) return;
    const thread = await findLivePollThread(this.db, matchId);
    if (!thread) return;
    const eventTitle = await this.eventTitle(eventId, matchId);
    const line = { kind: 'poll-locked-in', eventId, eventTitle } as const;
    await this.close(thread.id, line, `locked-in:${eventId}`);
  }

  async pollCancelled(matchId: number, reason: string | null): Promise<void> {
    const thread = await findLivePollThread(this.db, matchId);
    if (!thread) return;
    await this.close(
      thread.id,
      { kind: 'poll-cancelled', reason },
      'cancelled',
    );
  }

  async lineupDecided(lineupId: number): Promise<void> {
    const thread = await findLiveLineupThread(this.db, lineupId);
    if (!thread) return;
    const games = await this.decidedGames(lineupId);
    const line = { kind: 'lineup-decided', lineupId, games } as const;
    await this.close(thread.id, line, 'decided');
  }

  async lineupAborted(lineupId: number): Promise<void> {
    const thread = await findLiveLineupThread(this.db, lineupId);
    if (!thread) return;
    await this.close(thread.id, { kind: 'lineup-aborted' }, 'aborted');
  }

  /** A poll (re-)entered scheduling: its next cancel posts a line again. */
  async pollReopened(matchId: number): Promise<void> {
    const thread = await findLivePollThread(this.db, matchId);
    if (!thread) return;
    await this.forget(thread.id, POLL_END_KEYS);
  }

  /** A lineup left decided/archived for an open status: next end posts. */
  async lineupReopened(lineupId: number): Promise<void> {
    const thread = await findLiveLineupThread(this.db, lineupId);
    if (!thread) return;
    await this.forget(thread.id, LINEUP_END_KEYS);
  }

  private async forget(
    threadId: number,
    onceKeys: readonly string[],
  ): Promise<void> {
    await this.redis.del(...onceKeys.map((k) => closingOnceKey(threadId, k)));
  }

  private async close(
    threadId: number,
    line: ClosingLine,
    onceKey: string,
  ): Promise<void> {
    const text = closingLineText(line, await getClientUrl(this.settings));
    const outcome = await this.postClosingLine(threadId, text, onceKey);
    this.logger.debug(`Closing line ${onceKey} #${threadId}: ${outcome}`);
  }

  /**
   * One bot line into the thread's existing Discord post. Skips a thread
   * with no post, an unsent / deleted / locked one, or an offline bot; only
   * the caller that claims the once-key posts. A failed send releases the
   * key, logs one warning naming the thread and the line, and reports
   * `send-failed`: best-effort, nothing retries it.
   */
  async postClosingLine(
    threadId: number,
    text: string,
    onceKey: string,
  ): Promise<ClosingOutcome> {
    const link = await findThreadLink(this.db, threadId);
    if (!link || isUnsent(link)) return 'no-post';
    if (link.discordDeletedAt !== null || link.discordLockedAt !== null) {
      return 'closed-post';
    }
    if (!this.gateway.isOnline()) return 'offline';
    const key = closingOnceKey(threadId, onceKey);
    const claimed = await this.redis.set(
      key,
      '1',
      'EX',
      CLOSING_ONCE_TTL_SECONDS,
      'NX',
    );
    if (claimed === null) return 'already';
    return this.send(link.discordThreadId, text, threadId, onceKey);
  }

  /** Send a claimed line; a failure releases the key and warns once. */
  private async send(
    discordThreadId: string,
    text: string,
    threadId: number,
    onceKey: string,
  ): Promise<ClosingOutcome> {
    try {
      await this.gateway.mention(discordThreadId, text, []);
      return 'posted';
    } catch (err) {
      await this.redis.del(closingOnceKey(threadId, onceKey));
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Closing line ${onceKey} for thread #${threadId} lost (not retried): ${why}`,
      );
      return 'send-failed';
    }
  }

  /** The linked event's title; the poll's own title when unreadable. */
  private async eventTitle(eventId: number, matchId: number): Promise<string> {
    const e = schema.events;
    const [row] = await this.db
      .select({ title: e.title })
      .from(e)
      .where(eq(e.id, eventId))
      .limit(1);
    if (row) return row.title;
    const poll = await findPollForSync(this.db, matchId);
    return poll?.standalone ? poll.lineupTitle : (poll?.gameName ?? '');
  }

  /** The lineup's decided game, then its threshold-met matches, deduped. */
  private async decidedGames(lineupId: number): Promise<string[]> {
    const l = schema.communityLineups;
    const m = schema.communityLineupMatches;
    const g = schema.games;
    const [decided] = await this.db
      .select({ id: g.id, name: g.name })
      .from(l)
      .innerJoin(g, eq(g.id, l.decidedGameId))
      .where(eq(l.id, lineupId))
      .limit(1);
    const matched = await this.db
      .select({ id: g.id, name: g.name })
      .from(m)
      .innerJoin(g, eq(g.id, m.gameId))
      .where(and(eq(m.lineupId, lineupId), eq(m.thresholdMet, true)))
      .orderBy(m.id);
    const byId = new Map<number, string>();
    for (const r of decided ? [decided, ...matched] : matched) {
      if (!byId.has(r.id)) byId.set(r.id, r.name);
    }
    return [...byId.values()];
  }
}
