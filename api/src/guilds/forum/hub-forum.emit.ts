import type { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * ROK-2208 D2 — the event `HubForumService` emits after each successful HTTP
 * write. Inbound Discord writes call `hub-forum.writes` directly and never
 * emit, which is the first guard against echoing a Discord post back out.
 */

/** EventEmitter2 event name for every hub forum write. */
export const HUB_FORUM_CHANGED = 'hub-forum.changed';

/** What changed. Pins are emitted now and consumed by the pin-sync lane (S5). */
export type ForumOp =
  | 'thread.created'
  | 'thread.updated'
  | 'thread.deleted'
  | 'thread.pinned'
  | 'thread.unpinned'
  | 'reply.created'
  | 'reply.updated'
  | 'reply.deleted';

/** Payload of {@link HUB_FORUM_CHANGED}. */
export interface HubForumChange {
  guildId: number;
  op: ForumOp;
  threadId: number;
  /** Reply ops only. */
  replyId?: number;
  actorId: number;
}

/** Where the change happened. */
export type ForumRef = Pick<HubForumChange, 'guildId' | 'threadId' | 'replyId'>;

/** Emit {@link HUB_FORUM_CHANGED} for one successful HTTP write. */
export function emitForumChange(
  events: EventEmitter2,
  op: ForumOp,
  actorId: number,
  at: ForumRef,
): void {
  const change: HubForumChange = { ...at, op, actorId };
  events.emit(HUB_FORUM_CHANGED, change);
}
