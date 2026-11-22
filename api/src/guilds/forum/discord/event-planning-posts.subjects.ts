/**
 * ROK-2272 S10 — Discord-only posts for NON-HUB polls and lineups in the
 * event-planning forum. A poll's post is created on its first vote, a
 * lineup's when it enters voting; every other lifecycle emit only
 * re-derives an EXISTING post's `closes_at` (end + 1 h via S7's helpers, so
 * hub and non-hub subjects close at the same moment; null on reopen). A
 * subject that became hub-tagged or private, or is gone, is due now.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { EventPlanningPostSelect } from '../../../drizzle/schema/event-planning-posts';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import { findLineupForSync } from '../subject-discussion/lineup-discussion.queries';
import { lineupWriteClosesAt } from '../subject-discussion/lineup-discussion.sync';
import { findPollForSync } from '../subject-discussion/poll-discussion.queries';
import {
  pollSubjectTitle,
  pollWriteClosesAt,
} from '../subject-discussion/poll-discussion.sync';
import {
  EventPlanningPostCreator,
  toPlanningPostRef,
  type EventPlanningPostRef,
} from './event-planning-posts.create';
import {
  findLivePlanningPost,
  findOpenPlanningPollPosts,
  findVotingLineupsWithoutPlanningPost,
  setPlanningPostClosesAt,
} from './event-planning-posts.queries';
import { syncEach } from './event-planning-posts.reconcile';
import {
  lineupEligible,
  lineupOnPlanningPath,
  planningSubjectBody,
  pollEligible,
  pollOnPlanningPath,
} from './event-planning-posts.subjects.rules';
import { subjectPostTitle } from './hub-forum-discord-subject';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import { PollRescheduleCrosslink } from './poll-reschedule-crosslink';

const OPEN_POLL_BATCH = 50;
/** ROK-2287: lineups the catch-up posts per run (Discord rate limits). */
export const LINEUP_CATCH_UP_BATCH = 10;

@Injectable()
export class EventPlanningSubjectPosts {
  private readonly logger = new Logger(EventPlanningSubjectPosts.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    private readonly settings: SettingsService,
    private readonly creator: EventPlanningPostCreator,
    private readonly crosslink: PollRescheduleCrosslink,
  ) {}

  /** The poll's live post, created on first need; null when it gets none. */
  async ensurePollPost(
    matchId: number,
    now: Date = new Date(),
  ): Promise<EventPlanningPostRef | null> {
    const live = await findLivePlanningPost(this.db, 'poll', matchId);
    if (live) return toPlanningPostRef(live);
    const poll = await findPollForSync(this.db, matchId);
    if (!poll || !pollEligible(poll, now)) return null;
    const made = await this.creator.create({
      kind: 'poll',
      subjectId: matchId,
      title: subjectPostTitle('poll', pollSubjectTitle(poll)),
      body: planningSubjectBody(await getClientUrl(this.settings), {
        kind: 'poll',
        lineupId: poll.lineupId,
        matchId,
      }),
      closesAt: null,
    });
    if (!made) return null;
    if (made.created) {
      // The poll may have ended while the create ran, unseen (no row yet).
      await this.syncPoll(matchId, new Date());
      // ROK-2295: a reschedule poll's post links its event's (never throws).
      await this.crosslink.linkPollPost(matchId, made.ref.discordThreadId);
    }
    return made.ref;
  }

  /**
   * The poll's live post while the poll is still on the planning path; a
   * poll since hub-tagged or made private gets null and its post is made
   * due now (the sweep closes it). Never creates.
   */
  async livePollPostOnPath(
    matchId: number,
    now: Date = new Date(),
  ): Promise<EventPlanningPostSelect | null> {
    const post = await findLivePlanningPost(this.db, 'poll', matchId);
    if (!post) return null;
    const poll = await findPollForSync(this.db, matchId);
    if (poll && pollOnPlanningPath(poll)) return post;
    await this.closeNow(post, now);
    return null;
  }

  /** The lineup's live post, created on first need; null when it gets none. */
  async ensureLineupPost(
    lineupId: number,
  ): Promise<EventPlanningPostRef | null> {
    const live = await findLivePlanningPost(this.db, 'lineup', lineupId);
    if (live) return toPlanningPostRef(live);
    const lineup = await findLineupForSync(this.db, lineupId);
    if (!lineup || !lineupEligible(lineup)) return null;
    const made = await this.creator.create({
      kind: 'lineup',
      subjectId: lineupId,
      title: subjectPostTitle('lineup', lineup.title),
      body: planningSubjectBody(await getClientUrl(this.settings), {
        kind: 'lineup',
        lineupId,
      }),
      closesAt: null,
    });
    if (made?.created) await this.syncLineup(lineupId, new Date());
    return made?.ref ?? null;
  }

  /**
   * ROK-2287 catch-up: a lineup whose voting edge found the bot offline has
   * no registry row and no second trigger. Each eligible one created after
   * the resolved forum gets its post through `ensureLineupPost` (still the
   * authority); one failing lineup is warned and the rest go on. No forum
   * (or offline) → nothing. Returns how many ran.
   */
  async ensureMissingLineupPosts(
    now: Date = new Date(),
    limit: number = LINEUP_CATCH_UP_BATCH,
  ): Promise<number> {
    const forum = await this.creator.resolveForum();
    if (!forum) return 0;
    const ids = await findVotingLineupsWithoutPlanningPost(
      this.db,
      forum.forumId,
      now,
      limit,
    );
    return syncEach(
      ids,
      (id) => this.ensureLineupPost(id).then(() => undefined),
      (id, err) => this.warn(`catch-up of lineup ${id}`, err),
    );
  }

  /** Re-derive an EXISTING poll post's `closes_at` (never creates). */
  async syncPoll(matchId: number, now: Date = new Date()): Promise<void> {
    const post = await findLivePlanningPost(this.db, 'poll', matchId);
    if (!post) return;
    const poll = await findPollForSync(this.db, matchId);
    if (!poll || !pollOnPlanningPath(poll)) return this.closeNow(post, now);
    await this.writeClosesAt(post, pollWriteClosesAt(poll, post.closesAt, now));
  }

  /** Re-derive an EXISTING lineup post's `closes_at` (never creates). */
  async syncLineup(lineupId: number, now: Date = new Date()): Promise<void> {
    const post = await findLivePlanningPost(this.db, 'lineup', lineupId);
    if (!post) return;
    const lineup = await findLineupForSync(this.db, lineupId);
    if (!lineup || !lineupOnPlanningPath(lineup)) {
      return this.closeNow(post, now);
    }
    const closesAt = lineupWriteClosesAt(lineup, post.closesAt, now);
    await this.writeClosesAt(post, closesAt);
  }

  /**
   * Deadline pass: every live, unlocked poll post still open is re-derived
   * (a `phase_deadline` expiry emits nothing). One failing poll is logged
   * and the rest go on; returns how many synced.
   */
  async syncOpenPolls(now: Date = new Date()): Promise<number> {
    let afterId = 0;
    let synced = 0;
    for (;;) {
      const rows = await findOpenPlanningPollPosts(
        this.db,
        afterId,
        OPEN_POLL_BATCH,
      );
      const last = rows.at(-1);
      if (!last) return synced;
      synced += await syncEach(
        rows.map((r) => r.subjectId),
        (id) => this.syncPoll(id, now),
        (id, err) => this.warn(`deadline sync of poll ${id}`, err),
      );
      if (rows.length < OPEN_POLL_BATCH) return synced;
      afterId = last.id;
    }
  }

  /** Due now (unless already due), so the sweep closes the post. */
  private async closeNow(
    post: EventPlanningPostSelect,
    now: Date,
  ): Promise<void> {
    if (post.closesAt !== null && post.closesAt <= now) return;
    await setPlanningPostClosesAt(this.db, post.id, now);
  }

  private async writeClosesAt(
    post: EventPlanningPostSelect,
    closesAt: Date | null,
  ): Promise<void> {
    if (post.closesAt?.getTime() === closesAt?.getTime()) return;
    await setPlanningPostClosesAt(this.db, post.id, closesAt);
  }

  private warn(what: string, err: unknown): void {
    const why = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Planning post ${what} failed: ${why}`);
  }
}
