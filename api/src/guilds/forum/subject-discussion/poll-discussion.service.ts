/**
 * ROK-2272 S7a (R10) — the scheduling-poll discussion routes. The card
 * summary runs the lazy reconciler first (even ahead of its 404, so a
 * private / hub-less flip with no emit still converges on read), then
 * reports header + count to anyone signed in and the
 * newest replies to readers. A reply resolves the poll's LIVE thread, applies
 * the R7 gate (poll copy), then delegates to `HubForumService` (event scope:
 * no hub member gate — the thread context applies the poll matrix).
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  SUBJECT_DISCUSSION_LATEST_MAX,
  type HubForumLock,
  type HubForumReply,
  type SubjectDiscussion,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import {
  GuildAccessService,
  type GuildActor,
} from '../../guild-access.service';
import { findGuildKind } from '../../guild-core.queries';
import { assertNotHidden, isHiddenFrom } from '../../hub-hidden.helpers';
import { HubKindRegistry } from '../../hub-kind.registry';
import type { EventThreadActor } from '../event-discussion/event-discussion.access';
import { newestLiveReplies } from '../event-discussion/event-discussion.queries';
import { canFor } from '../hub-forum.helpers';
import { toForumReply, type HubForumThreadRecord } from '../hub-forum.mappers';
import { findThread, type Db } from '../hub-forum.queries';
import { HubForumService } from '../hub-forum.service';
import { assertCanReplyToPoll } from './poll-discussion.access';
import { resolvePollThread } from './poll-discussion.context';
import { findLivePollThread, findPollForSync } from './poll-discussion.queries';
import { syncPollDiscussion } from './poll-discussion.sync';

export const POLL_NOT_FOUND = 'Scheduling poll not found';
export const POLL_DISCUSSION_NOT_FOUND = 'This poll has no discussion';

@Injectable()
export class PollDiscussionService {
  /** Clock seam — specs pin it; never `sleep`. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly forum: HubForumService,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  /** `GET scheduling-polls/:matchId/discussion` — the poll-page card. */
  async summary(
    actor: GuildActor,
    matchId: number,
  ): Promise<SubjectDiscussion> {
    const now = this.now();
    // Sync BEFORE the 404: a subject that turned private or lost its hub
    // still has its thread closed + detached by this read (R6). An unknown
    // id is a sync no-op (nothing to detach, nothing created).
    await syncPollDiscussion(this.db, matchId, now);
    await this.requireHubPoll(matchId);
    const live = await findLivePollThread(this.db, matchId);
    const record = live && (await findThread(this.db, live.guildId, live.id));
    if (!live || !record) return { state: 'none' };
    if (!(await this.hubOpenTo(actor, live.guildId))) return { state: 'none' };
    const deps = { db: this.db, access: this.access, now };
    const { who, lock, isMember } = await resolvePollThread(
      deps,
      actor,
      record,
    );
    const open = record.thread.deletedAt === null && lock === null;
    return {
      state: 'ready',
      kind: 'poll',
      guildId: live.guildId,
      threadId: live.id,
      replyCount: record.thread.replyCount,
      latestReplies: who.canRead ? await this.latest(who, record, lock) : [],
      lock,
      can: { read: who.canRead, reply: open && who.canReply },
      member: isMember,
    };
  }

  /** `POST scheduling-polls/:matchId/discussion/replies`. */
  async createReply(
    actor: GuildActor,
    matchId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    await this.requireHubPoll(matchId);
    const live = await findLivePollThread(this.db, matchId);
    const record = live && (await findThread(this.db, live.guildId, live.id));
    if (!live || !record) {
      throw new NotFoundException(POLL_DISCUSSION_NOT_FOUND);
    }
    await this.requireHub(actor, live.guildId);
    const deps = { db: this.db, access: this.access, now: this.now() };
    const { who, lock } = await resolvePollThread(deps, actor, record);
    assertCanReplyToPoll(who.canReply, lock);
    return this.forum
      .forEventScope()
      .createReply(actor, live.guildId, live.id, input);
  }

  /** 404 for a missing, private (§3.7) or hub-less poll (non-hub: no thread). */
  private async requireHubPoll(matchId: number): Promise<void> {
    const poll = await findPollForSync(this.db, matchId);
    if (!poll || poll.visibility === 'private' || poll.guildId === null) {
      throw new NotFoundException(POLL_NOT_FOUND);
    }
  }

  private async latest(
    who: EventThreadActor,
    record: HubForumThreadRecord,
    lock: HubForumLock | null,
  ): Promise<HubForumReply[]> {
    const max = SUBJECT_DISCUSSION_LATEST_MAX;
    const rows = await newestLiveReplies(this.db, record.thread.id, max);
    const readOnly = lock !== null || !who.canReply;
    const opts = { now: this.now(), pinnable: false, readOnly };
    return rows.map((r) => toForumReply(r, canFor(who, r.reply, opts)));
  }

  /** Card: false while the owning plugin is off or the hub is hidden. */
  private async hubOpenTo(
    actor: GuildActor,
    guildId: number,
  ): Promise<boolean> {
    if (!(await this.hubKinds.forGuild(guildId))) return false;
    return !(await isHiddenFrom(this.db, actor, guildId));
  }

  /** HubKindActiveGuard (403) then HubVisibleGuard (404), as on hub routes. */
  private async requireHub(actor: GuildActor, guildId: number): Promise<void> {
    const kind = await findGuildKind(this.db, guildId);
    if (kind !== null) this.hubKinds.require(kind);
    await assertNotHidden(this.db, actor, guildId);
  }
}
