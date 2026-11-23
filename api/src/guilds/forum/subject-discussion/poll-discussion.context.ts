/**
 * ROK-2272 S7a (R7) — one poll thread plus who is looking: the facts a poll
 * thread's matrix needs (hub membership, vote, match membership) and the
 * resolved actor + read-only state. Vote/membership only count while the
 * thread is attached to its poll (mirrors event signups).
 */
import { and, eq } from 'drizzle-orm';
import type { HubForumLock } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { GuildActor } from '../../guild-access.service';
import type { EventThreadActor } from '../event-discussion/event-discussion.access';
import type { ForumThreadDeps } from '../event-discussion/forum-thread.context';
import type { HubForumThreadRecord } from '../hub-forum.mappers';
import type { Db } from '../hub-forum.queries';
import {
  pollThreadActor,
  pollThreadLock,
  type PollThreadFacts,
} from './poll-discussion.access';

/** True when `userId` has a schedule vote on any slot of `matchId`. */
export async function hasPollVote(
  db: Db,
  matchId: number,
  userId: number,
): Promise<boolean> {
  const v = schema.communityLineupScheduleVotes;
  const s = schema.communityLineupScheduleSlots;
  const rows = await db
    .select({ id: v.id })
    .from(v)
    .innerJoin(s, eq(s.id, v.slotId))
    .where(and(eq(s.matchId, matchId), eq(v.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** True when `userId` is a member (voted/bandwagon/added) of `matchId`. */
export async function isPollMatchMember(
  db: Db,
  matchId: number,
  userId: number,
): Promise<boolean> {
  const mm = schema.communityLineupMatchMembers;
  const rows = await db
    .select({ id: mm.id })
    .from(mm)
    .where(and(eq(mm.matchId, matchId), eq(mm.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

async function pollFacts(
  deps: ForumThreadDeps,
  actor: GuildActor,
  record: HubForumThreadRecord,
): Promise<PollThreadFacts> {
  const { thread } = record;
  const isMember = await deps.access.canView(actor, thread.guildId);
  const canModerate =
    isMember && (await deps.access.canEdit(actor, thread.guildId));
  const matchId = thread.eventDetachedAt === null ? thread.matchId : null;
  if (matchId === null) {
    return { isMember, canModerate, hasVoted: false, isMatchMember: false };
  }
  const hasVoted = await hasPollVote(deps.db, matchId, actor.id);
  const isMatchMember =
    hasVoted || (await isPollMatchMember(deps.db, matchId, actor.id));
  return { isMember, canModerate, hasVoted, isMatchMember };
}

/** What `resolvePollThread` reports about one viewer of one poll thread. */
export interface ResolvedPollThread {
  who: EventThreadActor;
  lock: HubForumLock | null;
  /** Hub member (`access.canView`) — the card's hub-thread vs panel link. */
  isMember: boolean;
}

/** A poll thread's viewer rights + read-only state, never throwing. */
export async function resolvePollThread(
  deps: ForumThreadDeps,
  actor: GuildActor,
  record: HubForumThreadRecord,
): Promise<ResolvedPollThread> {
  const facts = await pollFacts(deps, actor, record);
  const who = pollThreadActor(actor.id, facts);
  const lock = pollThreadLock(record.thread, deps.now);
  return { who, lock, isMember: facts.isMember };
}
