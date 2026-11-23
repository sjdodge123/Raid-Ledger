import {
  SUBJECT_DISCUSSION_LATEST_MAX,
  SubjectDiscussionCanSchema,
  SubjectDiscussionNoneSchema,
  SubjectDiscussionReadySchema,
  SubjectDiscussionSchema,
  type SubjectDiscussion,
  type SubjectDiscussionCan,
  type SubjectDiscussionNone,
  type SubjectDiscussionReady,
} from "./subject-discussion.schema.js";

/**
 * Event discussion (ROK-2226) — `GET /events/:id/discussion`, the event-page
 * card for a hub-tagged event's forum thread. Since ROK-2272 these are
 * aliases of the generalised subject-discussion schemas
 * (`subject-discussion.schema.ts`); an event response may carry
 * `kind: 'event'` or omit it.
 */

/** Replies the event-page card shows. */
export const EVENT_DISCUSSION_LATEST_MAX = SUBJECT_DISCUSSION_LATEST_MAX;

/** What the viewer may do in the event thread; computed server-side. */
export const EventDiscussionCanSchema = SubjectDiscussionCanSchema;
export type EventDiscussionCan = SubjectDiscussionCan;

export const EventDiscussionNoneSchema = SubjectDiscussionNoneSchema;
export type EventDiscussionNone = SubjectDiscussionNone;

export const EventDiscussionReadySchema = SubjectDiscussionReadySchema;
export type EventDiscussionReady = SubjectDiscussionReady;

/** `GET /events/:id/discussion`. A non-reader is never sent reply text. */
export const EventDiscussionSchema = SubjectDiscussionSchema;
export type EventDiscussion = SubjectDiscussion;
