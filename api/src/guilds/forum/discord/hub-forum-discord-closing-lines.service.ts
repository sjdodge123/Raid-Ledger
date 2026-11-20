/**
 * ROK-2272 S8 — the poll / lineup lifecycle in a hub thread's Discord post:
 * a poll's first vote creates the post; a lock-in, cancel, decide or abort
 * posts ONE closing bot line into the post that already exists (Discord
 * only — the RL page shows the end state itself). Never creates a post just
 * to close it, once per subject end. A reopen forgets the end's once-key so
 * the next end posts again. Best-effort: a failed send is logged and the
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
import {
  closingLineText,
  type ClosingLine,
} from './hub-forum-discord-closing-lines';
import {
  postHubClosingLine,
  postPlanningClosingLine,
  resolveClosingTarget,
  targetLabel,
  targetOnceKey,
  type ClosingOutcome,
  type ClosingSendDeps,
  type ClosingTarget,
} from './hub-forum-discord-closing-lines.target';
import { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

export {
  CLOSING_ONCE_TTL_SECONDS,
  closingOnceKey,
  planningClosingOnceKey,
  type ClosingOutcome,
} from './hub-forum-discord-closing-lines.target';

/** Once-keys that a reopen clears (lock-in keys on its event id instead). */
export const POLL_END_KEYS = ['cancelled'] as const;
export const LINEUP_END_KEYS = ['decided', 'aborted'] as const;

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

  async pollCancelled(matchId: number, reason: string | null): Promise<void> {
    const target = await resolveClosingTarget(this.db, 'poll', matchId);
    if (!target) return;
    await this.close(target, { kind: 'poll-cancelled', reason }, 'cancelled');
  }

  async lineupDecided(lineupId: number): Promise<void> {
    const target = await resolveClosingTarget(this.db, 'lineup', lineupId);
    if (!target) return;
    const games = await this.decidedGames(lineupId);
    const line = { kind: 'lineup-decided', lineupId, games } as const;
    await this.close(target, line, 'decided');
  }

  async lineupAborted(lineupId: number): Promise<void> {
    const target = await resolveClosingTarget(this.db, 'lineup', lineupId);
    if (!target) return;
    await this.close(target, { kind: 'lineup-aborted' }, 'aborted');
  }

  /** A poll (re-)entered scheduling: its next cancel posts a line again. */
  async pollReopened(matchId: number): Promise<void> {
    const target = await resolveClosingTarget(this.db, 'poll', matchId);
    if (!target) return;
    await this.forget(target, POLL_END_KEYS);
  }

  /** A lineup left decided/archived for an open status: next end posts. */
  async lineupReopened(lineupId: number): Promise<void> {
    const target = await resolveClosingTarget(this.db, 'lineup', lineupId);
    if (!target) return;
    await this.forget(target, LINEUP_END_KEYS);
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

  private async forget(
    target: ClosingTarget,
    onceKeys: readonly string[],
  ): Promise<void> {
    await this.redis.del(...onceKeys.map((k) => targetOnceKey(target, k)));
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
