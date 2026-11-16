import { z } from 'zod';
import { HubForumLockSchema, HubForumReplySchema } from './hub-forum.schema.js';

/**
 * Event discussion (ROK-2226) — `GET /events/:id/discussion`, the event-page
 * card for a hub-tagged event's forum thread. `none` when the event has no
 * live thread (untagged, ad-hoc, or the viewer may not see it). `ready`
 * carries the newest replies (≤3, oldest first) and what the viewer may do;
 * `latestReplies` is [] when the viewer cannot read the thread (header and
 * count only).
 */

const id = z.number().int().positive();

/** Replies the event-page card shows. */
export const EVENT_DISCUSSION_LATEST_MAX = 3;

/** What the viewer may do in the event thread; computed server-side. */
export const EventDiscussionCanSchema = z
  .object({ read: z.boolean(), reply: z.boolean() })
  .strict();
export type EventDiscussionCan = z.infer<typeof EventDiscussionCanSchema>;

export const EventDiscussionNoneSchema = z.object({ state: z.literal('none') }).strict();
export type EventDiscussionNone = z.infer<typeof EventDiscussionNoneSchema>;

export const EventDiscussionReadySchema = z
  .object({
    state: z.literal('ready'),
    guildId: id,
    threadId: id,
    /** Live replies only. */
    replyCount: z.number().int().nonnegative(),
    latestReplies: z.array(HubForumReplySchema).max(EVENT_DISCUSSION_LATEST_MAX),
    lock: HubForumLockSchema.nullable(),
    can: EventDiscussionCanSchema,
  })
  .strict();
export type EventDiscussionReady = z.infer<typeof EventDiscussionReadySchema>;

/** `GET /events/:id/discussion`. A non-reader is never sent reply text. */
export const EventDiscussionSchema = z
  .discriminatedUnion('state', [EventDiscussionNoneSchema, EventDiscussionReadySchema])
  .refine((v) => v.state === 'none' || v.can.read || v.latestReplies.length === 0, {
    message: 'latestReplies must be empty when the viewer cannot read',
    path: ['latestReplies'],
  });
export type EventDiscussion = z.infer<typeof EventDiscussionSchema>;
