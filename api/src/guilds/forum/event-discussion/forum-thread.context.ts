/**
 * ROK-2226 §6 — one thread plus who is looking, for every hub-forum route
 * that reads or writes inside a thread. A normal thread keeps the ROK-1175
 * rules (member/staff or 403, 403 before 404). The hub routes stay member-only
 * for every thread (403 before any lookup); inside an event thread the §6
 * matrix then decides reply/edit/moderate. A signed-up non-member reads and
 * writes through `events/:id/discussion` (§6.1), never through these routes.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { HubForumLock } from '@raid-ledger/contract';
import type {
  GuildAccessService,
  GuildActor,
} from '../../guild-access.service';
import { FORUM_NOT_MEMBER, resolveForumActor } from '../hub-forum.access';
import type { HubForumActor } from '../hub-forum.helpers';
import type { HubForumThreadRecord } from '../hub-forum.mappers';
import { findThread, type Db } from '../hub-forum.queries';
import {
  eventThreadActor,
  eventThreadLock,
  type EventThreadActor,
  type EventThreadFacts,
} from './event-discussion.access';
import { isEventSignup } from './event-discussion.queries';

/** The thread, the viewer's forum rights and the event-thread extras. */
export interface ForumThreadContext {
  record: HubForumThreadRecord;
  who: HubForumActor;
  /** May post a reply now (normal thread: always, for a member). */
  canReply: boolean;
  /** §5.4 read-only state; null while writable or for a normal thread. */
  lock: HubForumLock | null;
}

/** Deps the resolver needs from the calling service. */
export interface ForumThreadDeps {
  db: Db;
  access: GuildAccessService;
  now: Date;
}

/** §6 facts for an event thread; signup/creator only count while attached. */
async function eventFacts(
  deps: ForumThreadDeps,
  actor: GuildActor,
  record: HubForumThreadRecord,
): Promise<EventThreadFacts> {
  const { thread } = record;
  const isMember = await deps.access.canView(actor, thread.guildId);
  const canModerate =
    isMember && (await deps.access.canEdit(actor, thread.guildId));
  const event = thread.eventDetachedAt === null ? (record.event ?? null) : null;
  const isSignedUp =
    event !== null && (await isEventSignup(deps.db, event.id, actor.id));
  const isCreator = event !== null && event.creatorId === actor.id;
  return { isMember, canModerate, isSignedUp, isCreator };
}

/**
 * Load `threadId` in `guildId` and resolve the viewer. Hub routes: 403 (not
 * a member) before any lookup, exactly as before ROK-2226. `eventScoped`
 * (the `events/:id/discussion` routes, already narrowed to the event's live
 * thread) skips the member gate so the §6 matrix alone decides.
 */
export async function forumThreadContext(
  deps: ForumThreadDeps,
  actor: GuildActor,
  target: { guildId: number; threadId: number; eventScoped?: boolean },
): Promise<ForumThreadContext> {
  const member = target.eventScoped
    ? null
    : await resolveForumActor(deps.access, actor, target.guildId);
  const record = await findThread(deps.db, target.guildId, target.threadId);
  if (!record) throw new NotFoundException('Thread not found');
  if (record.thread.eventId === null) {
    const who =
      member ?? (await resolveForumActor(deps.access, actor, target.guildId));
    return { record, who, canReply: true, lock: null };
  }
  const { who, lock } = await resolveEventThread(deps, actor, record);
  if (!who.canRead) throw new ForbiddenException(FORUM_NOT_MEMBER);
  return { record, who, canReply: who.canReply, lock };
}

/** What `resolveEventThread` reports about one viewer of one event thread. */
export interface ResolvedEventThread {
  who: EventThreadActor;
  lock: HubForumLock | null;
  /** Hub member (`access.canView`) — the card's hub-thread vs panel link. */
  isMember: boolean;
}

/** An event thread's viewer rights + read-only state, never throwing (the card). */
export async function resolveEventThread(
  deps: ForumThreadDeps,
  actor: GuildActor,
  record: HubForumThreadRecord,
): Promise<ResolvedEventThread> {
  const facts = await eventFacts(deps, actor, record);
  const who = eventThreadActor(actor.id, facts);
  const exists = (record.event ?? null) !== null;
  const lock = eventThreadLock(record.thread, exists, deps.now);
  return { who, lock, isMember: facts.isMember };
}
