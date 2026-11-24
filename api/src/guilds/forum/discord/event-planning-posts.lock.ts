/**
 * ROK-2272 S4a §3.5 — the Discord close of registry posts
 * (`event_planning_posts`). A live post whose `closes_at` has passed is
 * locked THEN archived; one rescheduled into the future again is unarchived
 * THEN unlocked (parity with hub posts). `discord_locked_at` records the
 * state, so the 5-minute Core sweep (`HubForumDiscordSync_eventLockSweep`,
 * which runs this pass after the hub pass) is idempotent. A moderator who
 * unarchives a closed post is left alone: the recorded state already says
 * locked. ROK-2314: an event post is also closed while its event's
 * reschedule poll runs, and reopens only once the poll ended AND its
 * `closes_at` is still in the future.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  deleteForumStarterRows,
  EventForumStarterCards,
} from '../../../discord-bot/services/event-forum-starter.cards';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  markPlanningPostDeleted,
  setPlanningPostLocked,
  type PlanningSubjectKind,
} from './event-planning-posts.queries';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import {
  eventReschedulingSql,
  isEventRescheduling,
} from './event-rescheduling.sql';
import { HubForumDiscordEventLockGateway } from './hub-forum-discord-event-lock.gateway';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

const posts = schema.eventPlanningPosts;
/** Posts per tick; the rest wait 5 minutes. */
const BATCH = 50;

/** One registry post whose Discord lock state must flip. */
export interface RegistryLockChange {
  postId: number;
  subjectKind: PlanningSubjectKind;
  subjectId: number;
  discordThreadId: string;
  /** true = close (lock + archive); false = reopen. */
  readOnly: boolean;
}

function asKind(raw: string): PlanningSubjectKind {
  if (raw === 'event' || raw === 'poll' || raw === 'lineup') return raw;
  throw new Error(`Unknown event_planning_posts.subject_kind "${raw}"`);
}

/**
 * Open again: `closes_at` in the future, or (ROK-2272 S10, Codex P2) cleared
 * to null on a poll / lineup post — those are open while it is null. An
 * event post always has a `closes_at`, so a null one is left alone.
 */
function reopenedWhere(at: SQL) {
  return or(
    gt(posts.closesAt, at),
    and(isNull(posts.closesAt), inArray(posts.subjectKind, ['poll', 'lineup'])),
  );
}

/** ROK-2314: an event post whose event is mid-reschedule. */
const RESCHEDULING = sql<boolean>`(${posts.subjectKind} = 'event' AND ${eventReschedulingSql(posts.subjectId)})`;

/**
 * Live, and `closes_at` (or, ROK-2314, the event's reschedule poll)
 * disagrees with the recorded lock state.
 */
function dueWhere(at: SQL) {
  return and(
    isNull(posts.discordDeletedAt),
    or(
      and(
        or(lte(posts.closesAt, at), RESCHEDULING),
        isNull(posts.discordLockedAt),
      ),
      and(
        reopenedWhere(at),
        not(RESCHEDULING),
        isNotNull(posts.discordLockedAt),
      ),
    ),
  );
}

/** ROK-2314: optionally only one event's post. */
function forEvent(eventId: number | undefined) {
  if (eventId === undefined) return undefined;
  return and(eq(posts.subjectKind, 'event'), eq(posts.subjectId, eventId));
}

/**
 * Live posts whose lock state disagrees with `closes_at`: due and unlocked
 * ⇒ close; in the future and locked ⇒ reopen. A null `closes_at` is never
 * due to close; on a locked poll / lineup post it means reopened.
 * `eventId` narrows it to that event's post (ROK-2314).
 */
export async function dueRegistryLockChanges(
  db: ForumDiscordDb,
  now: Date,
  eventId?: number,
): Promise<RegistryLockChange[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const rows = await db
    .select({
      postId: posts.id,
      subjectKind: posts.subjectKind,
      subjectId: posts.subjectId,
      discordThreadId: posts.discordThreadId,
      locked: isNotNull(posts.discordLockedAt),
    })
    .from(posts)
    .where(and(dueWhere(at), forEvent(eventId)))
    .orderBy(posts.id)
    .limit(BATCH);
  return rows.map(({ locked, subjectKind, ...r }) => ({
    ...r,
    subjectKind: asKind(subjectKind),
    readOnly: !locked,
  }));
}

/**
 * Codex P2-1: what a signup flush may do with a locked post. `open` = write
 * (reopened now, or never locked); `closed` = genuinely past its close;
 * `failed` = a reopen is due but did not land (retry the flush).
 */
export type ReopenResult = 'open' | 'closed' | 'failed';

/**
 * One post's reopen state; null when it is gone (deleted or no row). An
 * event post stays `closed` while its reschedule poll runs (ROK-2314).
 */
async function reopenState(
  db: ForumDiscordDb,
  postId: number,
  now: Date,
): Promise<RegistryLockChange | 'open' | 'closed' | null> {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!row || row.discordDeletedAt !== null) return null;
  const kind = asKind(row.subjectKind);
  if (kind === 'event' && (await isEventRescheduling(db, row.subjectId)))
    return 'closed';
  if (row.closesAt === null || row.closesAt <= now) return 'closed';
  if (row.discordLockedAt === null) return 'open';
  return {
    postId,
    subjectKind: kind,
    subjectId: row.subjectId,
    discordThreadId: row.discordThreadId,
    readOnly: false,
  };
}

/** The registry pass of the Core lock sweep. */
@Injectable()
export class EventPlanningPostsLockSweep {
  private readonly logger = new Logger(EventPlanningPostsLockSweep.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly gateway: HubForumDiscordEventLockGateway,
    private readonly client: DiscordBotClientService,
    private readonly service: EventPlanningPostsService,
    private readonly subjects: EventPlanningSubjectPosts,
    private readonly starters: EventForumStarterCards,
  ) {}

  /**
   * Flip every due post; returns how many changed. Offline bot → 0.
   * ROK-2272 S10: first stamp `closes_at` on non-hub poll posts whose
   * `phase_deadline` passed with no emit; a throw there is warned and the
   * flip loop still runs. ROK-2287: then post voting lineups that have no
   * registry row yet (same warn-and-continue).
   */
  async sweep(now = new Date()): Promise<number> {
    if (!this.client.isConnected()) return 0;
    await this.syncOpenPolls(now);
    await this.catchUpLineups(now);
    return this.flipDue(now);
  }

  /**
   * ROK-2314: flip one event's post now (its reschedule poll opened or
   * ended). Offline bot → 0; the 5-minute sweep catches up.
   */
  async sweepEvent(eventId: number, now = new Date()): Promise<number> {
    if (!this.client.isConnected()) return 0;
    return this.flipDue(now, eventId);
  }

  private async flipDue(now: Date, eventId?: number): Promise<number> {
    let changed = 0;
    for (const row of await dueRegistryLockChanges(this.db, now, eventId)) {
      if (await this.apply(row, now)) changed += 1;
    }
    return changed;
  }

  private async syncOpenPolls(now: Date): Promise<void> {
    try {
      await this.subjects.syncOpenPolls(now);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Planning poll deadline pass: ${why}`);
    }
  }

  /** ROK-2287: post voting lineups whose edge found the bot offline. */
  private async catchUpLineups(now: Date): Promise<void> {
    try {
      await this.subjects.ensureMissingLineupPosts(now);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Planning lineup catch-up: ${why}`);
      Sentry.captureException(err, {
        tags: { event_planning_posts: 'lineup-catch-up-sweep' },
      });
    }
  }

  /**
   * Codex P2-1: reopen one post now when its `closes_at` moved into the
   * future but the sweep has not unlocked it yet — the same single-row
   * flip (and title refresh) the sweep does for a due reopen.
   */
  async reopenIfPending(
    postId: number,
    now = new Date(),
  ): Promise<ReopenResult> {
    const state = await reopenState(this.db, postId, now);
    if (state === null) return 'failed';
    if (state === 'open' || state === 'closed') return state;
    if (!this.client.isConnected()) return 'failed';
    if ((await this.flip(state, now)) !== 'ok') return 'failed';
    if (state.subjectKind === 'event') await this.refresh(state);
    return 'open';
  }

  private async apply(row: RegistryLockChange, now: Date): Promise<boolean> {
    const res = await this.flip(row, now);
    if (res === 'ok' && !row.readOnly && row.subjectKind === 'event') {
      await this.refresh(row);
    }
    return res !== 'failed';
  }

  /**
   * Discord first, then record it; a failure retries next tick. A post gone
   * from Discord is recorded deleted, never locked (review MAJOR-2).
   */
  private async flip(
    row: RegistryLockChange,
    now: Date,
  ): Promise<'ok' | 'gone' | 'failed'> {
    try {
      const { discordThreadId, readOnly, postId } = row;
      if (
        (await this.gateway.setReadOnly(discordThreadId, readOnly)) === 'gone'
      ) {
        await markPlanningPostDeleted(this.db, postId, now);
        return 'gone';
      }
      await setPlanningPostLocked(this.db, postId, readOnly ? now : null);
      // ROK-2292 D7: a closed post's starter is no longer synced.
      if (readOnly) await deleteForumStarterRows(this.db, discordThreadId);
      return 'ok';
    } catch (err) {
      this.warn(row, err);
      return 'failed';
    }
  }

  /**
   * Reopened: track the starter again (ROK-2292, D7 dropped it), then push
   * the title skipped while the post was locked.
   */
  private async refresh(row: RegistryLockChange): Promise<void> {
    try {
      await this.starters.restore(row.subjectId, row.discordThreadId);
      await this.service.syncEvent(row.subjectId);
    } catch (err) {
      this.warn(row, err);
    }
  }

  private warn(row: RegistryLockChange, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Planning post ${row.discordThreadId} lock: ${why}`);
  }
}
