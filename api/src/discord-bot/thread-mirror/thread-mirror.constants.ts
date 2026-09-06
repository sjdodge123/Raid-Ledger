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
