import type { ThreadSurfaceKind } from '@raid-ledger/contract';

/**
 * ROK-1483 — constants for the read-only Discord thread mirror.
 *
 * Kept in their own module (rather than on the service) so the listener, the
 * controller and `LfmEmbedService`'s bind hook can all reach them without
 * importing the service and dragging its module edge along with it.
 */

/**
 * D4: the bind hook is an EVENT, not a service edge.
 *
 * `LfmEmbedService.postForum` emits `BOUND` after it writes the
 * `lfg_group_messages` row; the mirror backfills on the other side. That keeps
 * `LfmEmbedModule` free of a third import into a mirror module, and it is the
 * exact seam ROK-1484 reuses — a lineup or poll surface emits the same event
 * with a different `surfaceKind` and the mirror needs no change.
 *
 * Precedent: `LFG_BOARD_EVENTS.FLUSH`.
 */
export const THREAD_MIRROR_EVENTS = {
  BOUND: 'thread-mirror.bound',
} as const;

/**
 * D13: the backfill walks at most two `messages.fetch({ limit: 100 })` pages.
 *
 * An uncapped walk is an unbounded Discord call loop inside a `CONNECTED`
 * handler, and a thread that ran hot for a week is not a page the viewer
 * should render anyway. Over the cap the panel footers "older messages are in
 * Discord" and links out.
 */
export const MAX_BACKFILL_MESSAGES = 200;

/** Page size when the caller names none. */
export const THREAD_MESSAGE_PAGE_DEFAULT = 50;

/** Hard ceiling — a larger `limit` is a 400 (Zod `.max`), never a silent clamp. */
export const THREAD_MESSAGE_PAGE_MAX = 100;

/**
 * Payload of {@link THREAD_MIRROR_EVENTS.BOUND}.
 *
 * `surfaceId` is a string for the same reason the wire contract's is: ROK-1484
 * carries uuids where `lfg-group` carries a numeric game id.
 */
export interface ThreadBoundPayload {
  threadId: string;
  guildId: string;
  surfaceKind: ThreadSurfaceKind;
  surfaceId: string;
}

/**
 * The one method of `EventEmitter2` the bind hook actually needs.
 *
 * Structural rather than the class: it keeps this module free of a runtime
 * import of `@nestjs/event-emitter`, and it lets a test pass `{ emit:
 * jest.fn() }` without constructing an emitter.
 */
export interface ThreadBoundEmitter {
  emit(event: string, payload: ThreadBoundPayload): unknown;
}

/**
 * Announce that an LFG group's forum thread is now bound to its surface (D4).
 *
 * Lives here rather than at the call site so `LfmEmbedService` imports ONE
 * symbol and states the emit in one line — the event name, the payload shape
 * and `surfaceId`'s number-to-string conversion are all stated once, beside
 * the event they belong to. ROK-1484 adds a sibling per surface kind.
 *
 * Fire-and-forget on purpose: this runs inside `POST /lfg`'s call stack, and a
 * listener failure must never surface to a player as a 500 on a successful
 * signup. Nest wraps `@OnEvent` handlers in try/catch, and the mirror guards
 * every write path of its own — so the safety lives in the consumers, not in a
 * try/catch around this call.
 *
 * @param events - The application event emitter.
 * @param threadId - The forum post's thread id.
 * @param guildId - The guild it lives in.
 * @param gameId - The game whose LFG group owns the thread.
 */
export function emitLfgThreadBound(
  events: ThreadBoundEmitter,
  threadId: string,
  guildId: string,
  gameId: number,
): void {
  events.emit(THREAD_MIRROR_EVENTS.BOUND, {
    threadId,
    guildId,
    surfaceKind: 'lfg-group',
    surfaceId: String(gameId),
  });
}
