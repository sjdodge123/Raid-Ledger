/**
 * ROK-2272 S7b (R10) — the community-lineup discussion routes (mirror of the
 * poll service). The card
 * summary runs the lazy reconciler first (even ahead of its 404, so a
 * private / hub-less flip with no emit still converges on read), then
 * reports header + count to anyone signed in and the
 * newest replies to readers. A reply resolves the lineup's LIVE thread, applies
 * the R7 gate (lineup copy), then delegates to `HubForumService` (event scope:
 * no hub member gate — the thread context applies the lineup matrix).
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
import { assertCanReplyToLineup } from './lineup-discussion.access';
import { resolveLineupThread } from './lineup-discussion.context';
import {
  findLineupForSync,
  findLiveLineupThread,
} from './lineup-discussion.queries';
import { syncLineupDiscussion } from './lineup-discussion.sync';

export const LINEUP_NOT_FOUND = 'Lineup not found';
export const LINEUP_DISCUSSION_NOT_FOUND = 'This lineup has no discussion';

@Injectable()
export class LineupDiscussionService {
  /** Clock seam — specs pin it; never `sleep`. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly forum: HubForumService,
    private readonly hubKinds: HubKindRegistry,
  ) {}

  /** `GET lineups/:id/discussion` — the lineup-page card. */
  async summary(
    actor: GuildActor,
    lineupId: number,
  ): Promise<SubjectDiscussion> {
    const now = this.now();
    // Sync BEFORE the 404: a subject that turned private or lost its hub
    // still has its thread closed + detached by this read (R6). An unknown
    // id is a sync no-op (nothing to detach, nothing created).
    await syncLineupDiscussion(this.db, lineupId, now);
    await this.requireHubLineup(lineupId);
    const live = await findLiveLineupThread(this.db, lineupId);
    const record = live && (await findThread(this.db, live.guildId, live.id));
    if (!live || !record) return { state: 'none' };
    if (!(await this.hubOpenTo(actor, live.guildId))) return { state: 'none' };
    const deps = { db: this.db, access: this.access, now };
    const { who, lock, isMember } = await resolveLineupThread(
      deps,
      actor,
      record,
    );
    const open = record.thread.deletedAt === null && lock === null;
    return {
      state: 'ready',
      kind: 'lineup',
      guildId: live.guildId,
      threadId: live.id,
      replyCount: record.thread.replyCount,
      latestReplies: who.canRead ? await this.latest(who, record, lock) : [],
      lock,
      can: { read: who.canRead, reply: open && who.canReply },
      member: isMember,
    };
  }

  /** `POST lineups/:id/discussion/replies`. */
  async createReply(
    actor: GuildActor,
    lineupId: number,
    input: unknown,
  ): Promise<HubForumReply> {
    await this.requireHubLineup(lineupId);
    const live = await findLiveLineupThread(this.db, lineupId);
    const record = live && (await findThread(this.db, live.guildId, live.id));
    if (!live || !record) {
      throw new NotFoundException(LINEUP_DISCUSSION_NOT_FOUND);
    }
    await this.requireHub(actor, live.guildId);
    const deps = { db: this.db, access: this.access, now: this.now() };
    const { who, lock } = await resolveLineupThread(deps, actor, record);
    assertCanReplyToLineup(who.canReply, lock);
    return this.forum
      .forEventScope()
      .createReply(actor, live.guildId, live.id, input);
  }

  /**
   * 404 for a missing, private (§3.7), hub-less (non-hub: no thread) or
   * standalone-carrier lineup (§3.1: the poll is the subject, not the lineup).
   */
  private async requireHubLineup(lineupId: number): Promise<void> {
    const l = await findLineupForSync(this.db, lineupId);
    if (
      !l ||
      l.visibility === 'private' ||
      l.guildId === null ||
      l.standalone
    ) {
      throw new NotFoundException(LINEUP_NOT_FOUND);
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
