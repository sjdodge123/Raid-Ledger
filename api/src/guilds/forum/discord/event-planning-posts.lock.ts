/**
 * ROK-2272 S4a §3.5 — the Discord close of registry posts
 * (`event_planning_posts`). A live post whose `closes_at` has passed is
 * locked THEN archived; one rescheduled into the future again is unarchived
 * THEN unlocked (parity with hub posts). `discord_locked_at` records the
 * state, so the 5-minute Core sweep (`HubForumDiscordSync_eventLockSweep`,
 * which runs this pass after the hub pass) is idempotent. A moderator who
 * unarchives a closed post is left alone: the recorded state already says
 * locked.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  markPlanningPostDeleted,
  setPlanningPostLocked,
  type PlanningSubjectKind,
} from './event-planning-posts.queries';
import { EventPlanningPostsService } from './event-planning-posts.service';
import { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
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

/** Live, and `closes_at` disagrees with the recorded lock state. */
function dueWhere(at: SQL) {
  return and(
    isNull(posts.discordDeletedAt),
    or(
      and(lte(posts.closesAt, at), isNull(posts.discordLockedAt)),
      and(gt(posts.closesAt, at), isNotNull(posts.discordLockedAt)),
    ),
  );
}

/**
 * Live posts whose lock state disagrees with `closes_at`: due and unlocked
 * ⇒ close; in the future and locked ⇒ reopen. A null `closes_at` is never
 * due.
 */
export async function dueRegistryLockChanges(
  db: ForumDiscordDb,
  now: Date,
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
    .where(dueWhere(at))
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

/** One post's reopen state; null when it is gone (deleted or no row). */
async function reopenState(
  db: ForumDiscordDb,
  postId: number,
  now: Date,
): Promise<RegistryLockChange | 'open' | 'closed' | null> {
  const [row] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!row || row.discordDeletedAt !== null) return null;
  if (row.closesAt === null || row.closesAt <= now) return 'closed';
  if (row.discordLockedAt === null) return 'open';
  return {
    postId,
    subjectKind: asKind(row.subjectKind),
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
  ) {}

  /**
   * Flip every due post; returns how many changed. Offline bot → 0.
   * ROK-2272 S10: first stamp `closes_at` on non-hub poll posts whose
   * `phase_deadline` passed with no emit; a throw there is warned and the
   * flip loop still runs.
   */
  async sweep(now = new Date()): Promise<number> {
    if (!this.client.isConnected()) return 0;
    await this.syncOpenPolls(now);
    let changed = 0;
    for (const row of await dueRegistryLockChanges(this.db, now)) {
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
      return 'ok';
    } catch (err) {
      this.warn(row, err);
      return 'failed';
    }
  }

  /** Reopened: push the title skipped while the post was locked. */
  private async refresh(row: RegistryLockChange): Promise<void> {
    try {
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
