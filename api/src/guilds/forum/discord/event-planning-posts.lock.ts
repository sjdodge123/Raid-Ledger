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
import { and, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import {
  setPlanningPostLocked,
  type PlanningSubjectKind,
} from './event-planning-posts.queries';
import { EventPlanningPostsService } from './event-planning-posts.service';
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
    .where(
      and(
        isNull(posts.discordDeletedAt),
        or(
          and(lte(posts.closesAt, at), isNull(posts.discordLockedAt)),
          and(gt(posts.closesAt, at), isNotNull(posts.discordLockedAt)),
        ),
      ),
    )
    .orderBy(posts.id)
    .limit(BATCH);
  return rows.map(({ locked, subjectKind, ...r }) => ({
    ...r,
    subjectKind: asKind(subjectKind),
    readOnly: !locked,
  }));
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
  ) {}

  /** Flip every due post; returns how many changed. Offline bot → 0. */
  async sweep(now = new Date()): Promise<number> {
    if (!this.client.isConnected()) return 0;
    let changed = 0;
    for (const row of await dueRegistryLockChanges(this.db, now)) {
      if (await this.apply(row, now)) changed += 1;
    }
    return changed;
  }

  /** Discord first, then record it; a failure retries next tick. */
  private async apply(row: RegistryLockChange, now: Date): Promise<boolean> {
    try {
      await this.gateway.setReadOnly(row.discordThreadId, row.readOnly);
      await setPlanningPostLocked(this.db, row.postId, row.readOnly ? now : null);
    } catch (err) {
      this.warn(row, err);
      return false;
    }
    if (!row.readOnly && row.subjectKind === 'event') await this.refresh(row);
    return true;
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
