/**
 * ROK-2272 S8 — the poll / lineup lifecycle in a hub thread's Discord post:
 * a poll's first vote creates the post; a lock-in, cancel, decide or abort
 * posts ONE closing bot line into the post that already exists (Discord
 * only — the RL page shows the end state itself). Never creates a post just
 * to close it, once per subject end. A reopen bumps the subject's generation
 * so the next end claims a fresh once-key and posts again (L4491). Best-effort: a failed send is logged and the
 * line is lost (nothing re-emits an end); it never throws into the listener.
 * S10: a non-hub subject (no live hub thread) gets the same line in its
 * registry planning post — target + send arms in `.target.ts`.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import { findPollForSync } from '../subject-discussion/poll-discussion.queries';
import { pollSubjectTitle } from '../subject-discussion/poll-discussion.sync';
import {
  closingLineText,
  type ClosingLine,
} from './hub-forum-discord-closing-lines';
import {
  CLOSING_GEN_TTL_SECONDS,
  closingGenKey,
  genOnceKey,
  postHubClosingLine,
  postPlanningClosingLine,
  resolveClosingTarget,
  targetLabel,
  type ClosingOutcome,
  type ClosingSendDeps,
  type ClosingSubject,
  type ClosingTarget,
} from './hub-forum-discord-closing-lines.target';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

export {
  CLOSING_ONCE_TTL_SECONDS,
  closingGenKey,
  closingOnceKey,
  genOnceKey,
  planningClosingOnceKey,
  type ClosingOutcome,
} from './hub-forum-discord-closing-lines.target';

@Injectable()
export class HubForumDiscordClosingLines {
  private readonly logger = new Logger(HubForumDiscordClosingLines.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordOutboundGateway,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly settings: SettingsService,
  ) {}

  /** A poll locked in: the event line. An eventless lock-in posts nothing. */
  async pollLockedIn(matchId: number, eventId: number | null): Promise<void> {
    if (eventId === null) return;
    const target = await resolveClosingTarget(this.db, 'poll', matchId);
    if (!target) return;
    const eventTitle = await this.eventTitle(eventId, matchId);
    const line = { kind: 'poll-locked-in', eventId, eventTitle } as const;
    await this.close(target, line, `locked-in:${eventId}`);
  }

  /*
   * L4491: every end reads its subject's reopen generation as its FIRST
   * await. The end is emitted before any reopen of it, and one Redis
   * connection is FIFO, so this GET always lands before that reopen's INCR.
   * Never put another await in front of `endGen`.
   */
  async pollCancelled(matchId: number, reason: string | null): Promise<void> {
    const gen = await this.endGen('poll', matchId);
    const target = await resolveClosingTarget(this.db, 'poll', matchId);
    if (!target) return;
    const line = { kind: 'poll-cancelled', reason } as const;
    await this.close(target, line, genOnceKey('cancelled', gen));
  }

  async lineupDecided(lineupId: number): Promise<void> {
    const gen = await this.endGen('lineup', lineupId);
    const target = await resolveClosingTarget(this.db, 'lineup', lineupId);
    if (!target) return;
    const games = await this.decidedGames(lineupId);
    const line = { kind: 'lineup-decided', lineupId, games } as const;
    await this.close(target, line, genOnceKey('decided', gen));
  }

  async lineupAborted(lineupId: number): Promise<void> {
    const gen = await this.endGen('lineup', lineupId);
    const target = await resolveClosingTarget(this.db, 'lineup', lineupId);
    if (!target) return;
    const line = { kind: 'lineup-aborted' } as const;
    await this.close(target, line, genOnceKey('aborted', gen));
  }

  /** A poll (re-)entered scheduling: its next cancel posts a line again. */
  async pollReopened(matchId: number): Promise<void> {
    await this.bumpGen('poll', matchId);
  }

  /** A lineup left decided/archived for an open status: next end posts. */
  async lineupReopened(lineupId: number): Promise<void> {
    await this.bumpGen('lineup', lineupId);
  }

  /**
   * One bot line into a hub thread's existing Discord post (S8 arm — see
   * `postHubClosingLine` for every skip).
   */
  async postClosingLine(
    threadId: number,
    text: string,
    onceKey: string,
  ): Promise<ClosingOutcome> {
    return postHubClosingLine(this.deps(), threadId, text, onceKey);
  }

  /** The subject's reopen generation; a live counter's TTL is refreshed. */
  private async endGen(kind: ClosingSubject, id: number): Promise<number> {
    const key = closingGenKey(kind, id);
    const gen = Number((await this.redis.get(key)) ?? 0);
    if (gen > 0) await this.redis.expire(key, CLOSING_GEN_TTL_SECONDS);
    return gen;
  }

  private async bumpGen(kind: ClosingSubject, id: number): Promise<void> {
    const key = closingGenKey(kind, id);
    await this.redis
      .multi()
      .incr(key)
      .expire(key, CLOSING_GEN_TTL_SECONDS)
      .exec();
  }

  private async close(
    target: ClosingTarget,
    line: ClosingLine,
    onceKey: string,
  ): Promise<void> {
    const text = closingLineText(line, await getClientUrl(this.settings));
    const outcome =
      target.kind === 'hub'
        ? await this.postClosingLine(target.threadId, text, onceKey)
        : await postPlanningClosingLine(this.deps(), target, text, onceKey);
    this.logger.debug(
      `Closing line ${onceKey} ${targetLabel(target)}: ${outcome}`,
    );
  }

  private deps(): ClosingSendDeps {
    const { db, redis, gateway, logger } = this;
    return { db, redis, gateway, logger };
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
    return poll ? pollSubjectTitle(poll) : '';
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
