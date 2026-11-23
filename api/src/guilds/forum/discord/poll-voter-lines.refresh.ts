/**
 * ROK-2295 lane C — keeps each poll voter's line (`🗳 <@id> voted: <t:…>`)
 * listing the slots they hold. The ping service stores the line's message
 * id here on the first committed vote; every coalesced poll-card re-render
 * (`PollForumStarterSync.syncStarter`) then calls `refreshVoterLines`, which
 * re-reads the stored voters' slots in one query and edits only the lines
 * whose slots changed — a vote burst is one edit per changed voter, never a
 * new message or a new ping. A post with no hash (lines sent before this
 * story) is left alone. Every Discord / Redis step is best effort.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import {
  sameSlots,
  storedVoterLines,
  VOTER_ONCE_TTL_SECONDS,
  voterLine,
  voterLinesKey,
  type StoredVoterLine,
} from './hub-forum-discord-poll-voter-pings';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * Each user's `yes` slots on the poll, ascending ISO times (a `no` is a
 * decline and is not listed). Every asked user gets an entry.
 */
export async function readVoterSlots(
  db: ForumDiscordDb,
  matchId: number,
  userIds: readonly number[],
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return out;
  const v = schema.communityLineupScheduleVotes;
  const s = schema.communityLineupScheduleSlots;
  const rows = await db
    .select({ userId: v.userId, at: s.proposedTime })
    .from(v)
    .innerJoin(s, eq(s.id, v.slotId))
    .where(
      and(
        eq(s.matchId, matchId),
        inArray(v.userId, [...userIds]),
        eq(v.stance, 'yes'),
      ),
    )
    .orderBy(asc(s.proposedTime), asc(s.id));
  for (const r of rows) out.get(r.userId)?.push(r.at.toISOString());
  return out;
}

@Injectable()
export class PollVoterLines {
  private readonly logger = new Logger(PollVoterLines.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordOutboundGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** One voter's slots now (the first line is built from these). */
  async slotsOf(matchId: number, userId: number): Promise<string[]> {
    const all = await readVoterSlots(this.db, matchId, [userId]);
    return all.get(userId) ?? [];
  }

  /** Remember a sent line so later votes edit it; a failure is logged. */
  async store(
    discordThreadId: string,
    userId: number,
    line: StoredVoterLine,
  ): Promise<void> {
    try {
      await this.write(voterLinesKey(discordThreadId), userId, line);
    } catch (err) {
      this.warn(`store line for user ${userId} in ${discordThreadId}`, err);
    }
  }

  /** Edit every stored line whose slots changed. Never throws. */
  async refreshVoterLines(
    matchId: number,
    discordThreadId: string,
  ): Promise<void> {
    try {
      await this.refreshAll(matchId, discordThreadId);
    } catch (err) {
      this.warn(`refresh poll ${matchId} lines in ${discordThreadId}`, err);
    }
  }

  private async refreshAll(matchId: number, threadId: string): Promise<void> {
    if (!this.gateway.isOnline()) return;
    const key = voterLinesKey(threadId);
    const stored = storedVoterLines(await this.redis.hgetall(key));
    if (stored.size === 0) return;
    const now = await readVoterSlots(this.db, matchId, [...stored.keys()]);
    for (const [userId, line] of stored) {
      const slots = now.get(userId) ?? [];
      if (sameSlots(slots, line.slots)) continue;
      await this.editOne(key, threadId, userId, { ...line, slots });
    }
  }

  /** One in-place edit; a vanished message (10008 / 404) drops its field. */
  private async editOne(
    key: string,
    threadId: string,
    userId: number,
    next: StoredVoterLine,
  ): Promise<void> {
    try {
      const content = voterLine(next.discordId, next.slots);
      const res = await this.gateway.editBotMessage(
        threadId,
        next.messageId,
        content,
      );
      if (res === 'gone') await this.redis.hdel(key, String(userId));
      else await this.write(key, userId, next);
    } catch (err) {
      this.warn(`edit line for user ${userId} in ${threadId}`, err);
    }
  }

  private async write(
    key: string,
    userId: number,
    line: StoredVoterLine,
  ): Promise<void> {
    await this.redis.hset(key, { [String(userId)]: JSON.stringify(line) });
    await this.redis.expire(key, VOTER_ONCE_TTL_SECONDS);
  }

  private warn(what: string, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Voter line: could not ${what}: ${why}`);
  }
}
