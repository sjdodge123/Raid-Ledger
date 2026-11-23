/**
 * ROK-2272 S7b (R7) — one lineup thread plus who is looking: the facts a
 * lineup thread's matrix needs (hub membership, nomination, any vote —
 * round, tiebreaker bracket or veto) and the
 * resolved actor + read-only state. Nominations and votes only count while
 * the thread is attached to its lineup (mirrors event signups / poll votes).
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
  lineupThreadActor,
  lineupThreadLock,
  type LineupThreadFacts,
} from './lineup-discussion.access';

/**
 * True when `userId` nominated an entry of `lineupId`. A carried-over entry
 * keeps its original nominator, who therefore counts as a participant here —
 * deliberate (ROK-2272 R7, ruled 2026-11-20).
 */
export async function hasLineupNomination(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<boolean> {
  const e = schema.communityLineupEntries;
  const rows = await db
    .select({ id: e.id })
    .from(e)
    .where(and(eq(e.lineupId, lineupId), eq(e.nominatedBy, userId)))
    .limit(1);
  return rows.length > 0;
}

/** True when `userId` has a nomination-round vote row on `lineupId`. */
async function hasRoundVote(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<boolean> {
  const v = schema.communityLineupVotes;
  const rows = await db
    .select({ id: v.id })
    .from(v)
    .where(and(eq(v.lineupId, lineupId), eq(v.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** True when `userId` voted in a tiebreaker bracket matchup of `lineupId`. */
async function hasBracketVote(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<boolean> {
  const t = schema.communityLineupTiebreakers;
  const m = schema.communityLineupTiebreakerBracketMatchups;
  const v = schema.communityLineupTiebreakerBracketVotes;
  const rows = await db
    .select({ id: v.id })
    .from(v)
    .innerJoin(m, eq(m.id, v.matchupId))
    .innerJoin(t, eq(t.id, m.tiebreakerId))
    .where(and(eq(t.lineupId, lineupId), eq(v.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** True when `userId` cast a veto in a tiebreaker of `lineupId`. */
async function hasVeto(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<boolean> {
  const t = schema.communityLineupTiebreakers;
  const v = schema.communityLineupTiebreakerVetoes;
  const rows = await db
    .select({ id: v.id })
    .from(v)
    .innerJoin(t, eq(t.id, v.tiebreakerId))
    .where(and(eq(t.lineupId, lineupId), eq(v.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * True when `userId` voted on `lineupId` in any form (R7 "has voted"): a
 * nomination-round vote, a tiebreaker bracket vote, or a tiebreaker veto.
 */
export async function hasLineupVote(
  db: Db,
  lineupId: number,
  userId: number,
): Promise<boolean> {
  const checks = await Promise.all([
    hasRoundVote(db, lineupId, userId),
    hasBracketVote(db, lineupId, userId),
    hasVeto(db, lineupId, userId),
  ]);
  return checks.some(Boolean);
}

async function lineupFacts(
  deps: ForumThreadDeps,
  actor: GuildActor,
  record: HubForumThreadRecord,
): Promise<LineupThreadFacts> {
  const { thread } = record;
  const isMember = await deps.access.canView(actor, thread.guildId);
  const canModerate =
    isMember && (await deps.access.canEdit(actor, thread.guildId));
  const lineupId = thread.eventDetachedAt === null ? thread.lineupId : null;
  if (lineupId === null) {
    return { isMember, canModerate, hasNominated: false, hasVoted: false };
  }
  const hasNominated = await hasLineupNomination(deps.db, lineupId, actor.id);
  const hasVoted =
    !hasNominated && (await hasLineupVote(deps.db, lineupId, actor.id));
  return { isMember, canModerate, hasNominated, hasVoted };
}

/** What `resolveLineupThread` reports about one viewer of one lineup thread. */
export interface ResolvedLineupThread {
  who: EventThreadActor;
  lock: HubForumLock | null;
  /** Hub member (`access.canView`) — the card's hub-thread vs panel link. */
  isMember: boolean;
}

/** A lineup thread's viewer rights + read-only state, never throwing. */
export async function resolveLineupThread(
  deps: ForumThreadDeps,
  actor: GuildActor,
  record: HubForumThreadRecord,
): Promise<ResolvedLineupThread> {
  const facts = await lineupFacts(deps, actor, record);
  const who = lineupThreadActor(actor.id, facts);
  const lock = lineupThreadLock(record.thread, deps.now);
  return { who, lock, isMember: facts.isMember };
}
