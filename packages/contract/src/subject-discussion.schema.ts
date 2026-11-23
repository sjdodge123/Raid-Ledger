import { z } from "zod";
import { HubForumLockSchema, HubForumReplySchema } from "./hub-forum.schema.js";

/**
 * Subject discussion (ROK-2272, generalises ROK-2226) — the synced
 * Discussion card for a hub subject's forum thread: an event, a scheduling
 * poll (`community_lineup_matches`) or a lineup (`community_lineups`).
 * `none` when the subject has no live thread (no hub, ad-hoc, private, or the
 * viewer may not see it). `ready` carries the newest replies (≤3, oldest
 * first) and what the viewer may do; `latestReplies` is [] when the viewer
 * cannot read the thread (header and count only).
 *
 * `event-discussion.schema.ts` keeps its exports as aliases of these.
 */

const id = z.number().int().positive();

/** The subjects a discussion thread can belong to. */
export const DISCUSSION_SUBJECT_KINDS = ["event", "poll", "lineup"] as const;
export const DiscussionSubjectKindSchema = z.enum(DISCUSSION_SUBJECT_KINDS);
export type DiscussionSubjectKind = z.infer<typeof DiscussionSubjectKindSchema>;

/** Replies the subject-page card shows. */
export const SUBJECT_DISCUSSION_LATEST_MAX = 3;

/** What the viewer may do in the subject thread; computed server-side. */
export const SubjectDiscussionCanSchema = z
  .object({ read: z.boolean(), reply: z.boolean() })
  .strict();
export type SubjectDiscussionCan = z.infer<typeof SubjectDiscussionCanSchema>;

export const SubjectDiscussionNoneSchema = z
  .object({ state: z.literal("none") })
  .strict();
export type SubjectDiscussionNone = z.infer<typeof SubjectDiscussionNoneSchema>;

export const SubjectDiscussionReadySchema = z
  .object({
    state: z.literal("ready"),
    /**
     * Which subject the thread discusses. Optional and additive — absent
     * means `event` (the ROK-2226 shape, unchanged).
     */
    kind: DiscussionSubjectKindSchema.optional(),
    guildId: id,
    threadId: id,
    /** Live replies only. */
    replyCount: z.number().int().nonnegative(),
    latestReplies: z
      .array(HubForumReplySchema)
      .max(SUBJECT_DISCUSSION_LATEST_MAX),
    lock: HubForumLockSchema.nullable(),
    can: SubjectDiscussionCanSchema,
    /**
     * The viewer is a member of the thread's hub (ROK-2226 spec §7 / AC13):
     * the card links members to the hub thread and everyone else to the
     * subject-page panel. Optional — absent means "not a member".
     */
    member: z.boolean().optional(),
  })
  .strict();
export type SubjectDiscussionReady = z.infer<
  typeof SubjectDiscussionReadySchema
>;

/**
 * `GET /events/:id/discussion` and the poll / lineup equivalents. A
 * non-reader is never sent reply text.
 */
export const SubjectDiscussionSchema = z
  .discriminatedUnion("state", [
    SubjectDiscussionNoneSchema,
    SubjectDiscussionReadySchema,
  ])
  .refine(
    (v) => v.state === "none" || v.can.read || v.latestReplies.length === 0,
    {
      message: "latestReplies must be empty when the viewer cannot read",
      path: ["latestReplies"],
    },
  );
export type SubjectDiscussion = z.infer<typeof SubjectDiscussionSchema>;
