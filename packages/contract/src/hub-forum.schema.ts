import { z } from 'zod';
import { HubPostBodyInputSchema, HubPostPersonSchema } from './hub-posts.schema.js';

/**
 * Hub Forum (ROK-1175) — member threads with flat replies and officer pins,
 * a Core-plugin tab on every hub kind. Bodies reuse the Posts markdown subset
 * and its 4000-char source cap (`HubPostBodyInputSchema`); titles are plain
 * text, required, ≤120 chars.
 *
 * Soft delete keeps the row: responses blank `title` / `preview` / `body`
 * and carry `deleted` saying who removed it. Nobody (staff included) is ever
 * sent removed text.
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

export const HUB_FORUM_TITLE_MAX = 120;
export const HUB_FORUM_PAGE_DEFAULT = 20;
export const HUB_FORUM_PAGE_MAX = 50;
/** Authors may edit a thread or reply for this long after creating it. */
export const HUB_FORUM_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Plain-text preview length of a thread summary (server-side truncation). */
export const HUB_FORUM_PREVIEW_MAX = 160;
/** Threads the Overview widget shows. */
export const HUB_FORUM_LATEST_LIMIT = 3;

/** Who removed a row; null while it is live. */
export const HubForumDeletedSchema = z.enum(['author', 'moderator']).nullable();
export type HubForumDeleted = z.infer<typeof HubForumDeletedSchema>;

/** What the viewer may do to this row; computed server-side. */
export const HubForumCanSchema = z
  .object({ edit: z.boolean(), delete: z.boolean(), pin: z.boolean() })
  .strict();
export type HubForumCan = z.infer<typeof HubForumCanSchema>;

/** A thread row in the list and the widget. */
export const HubForumThreadSummarySchema = z
  .object({
    id,
    /** '' when deleted. */
    title: z.string(),
    /** First ~160 plain chars of the body; '' when deleted. */
    preview: z.string(),
    /** Null once the author's account is deleted (SET NULL). */
    author: HubPostPersonSchema.nullable(),
    createdAt: isoDate,
    lastActivityAt: isoDate,
    /** Live replies only. */
    replyCount: z.number().int().nonnegative(),
    pinnedAt: isoDate.nullable(),
    deleted: HubForumDeletedSchema,
  })
  .strict();
export type HubForumThreadSummary = z.infer<typeof HubForumThreadSummarySchema>;

/** `GET /guilds/:id/forum` — pinned (newest pin first), then latest activity. */
export const HubForumThreadListSchema = z
  .object({
    /** First page only; [] on later pages. */
    pinned: z.array(HubForumThreadSummarySchema),
    threads: z.array(HubForumThreadSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type HubForumThreadList = z.infer<typeof HubForumThreadListSchema>;

/** Query of `GET /guilds/:id/forum`. */
export const HubForumListQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(HUB_FORUM_PAGE_MAX)
      .default(HUB_FORUM_PAGE_DEFAULT),
  })
  .strict();
export type HubForumListQuery = z.infer<typeof HubForumListQuerySchema>;

/** Query of `GET /guilds/:id/forum/:threadId` (reply paging). */
export const HubForumThreadQuerySchema = z
  .object({ replyCursor: z.string().max(200).optional() })
  .strict();
export type HubForumThreadQuery = z.infer<typeof HubForumThreadQuerySchema>;

/** A flat reply, oldest first. */
export const HubForumReplySchema = z
  .object({
    id,
    /** '' when deleted. */
    body: z.string(),
    author: HubPostPersonSchema.nullable(),
    createdAt: isoDate,
    editedAt: isoDate.nullable(),
    deleted: HubForumDeletedSchema,
    can: HubForumCanSchema,
  })
  .strict();
export type HubForumReply = z.infer<typeof HubForumReplySchema>;

/** `GET /guilds/:id/forum/:threadId` — the root post plus a page of replies. */
export const HubForumThreadSchema = HubForumThreadSummarySchema.extend({
  /** Markdown source; '' when deleted. */
  body: z.string(),
  editedAt: isoDate.nullable(),
  can: HubForumCanSchema,
  replies: z.array(HubForumReplySchema),
  nextReplyCursor: z.string().nullable(),
}).strict();
export type HubForumThread = z.infer<typeof HubForumThreadSchema>;

/** Write-side title: trimmed plain text, 1..120 chars. */
export const HubForumTitleInputSchema = z.string().trim().min(1).max(HUB_FORUM_TITLE_MAX);

/** `POST /guilds/:id/forum`. */
export const CreateHubForumThreadSchema = z
  .object({ title: HubForumTitleInputSchema, body: HubPostBodyInputSchema })
  .strict();
export type CreateHubForumThreadInput = z.infer<typeof CreateHubForumThreadSchema>;

/** `PATCH /guilds/:id/forum/:threadId` — author only, within the edit window. */
export const UpdateHubForumThreadSchema = z
  .object({
    title: HubForumTitleInputSchema.optional(),
    body: HubPostBodyInputSchema.optional(),
  })
  .strict()
  .refine((v) => v.title !== undefined || v.body !== undefined, 'Nothing to change');
export type UpdateHubForumThreadInput = z.infer<typeof UpdateHubForumThreadSchema>;

/** `POST /guilds/:id/forum/:threadId/replies`. */
export const CreateHubForumReplySchema = z.object({ body: HubPostBodyInputSchema }).strict();
export type CreateHubForumReplyInput = z.infer<typeof CreateHubForumReplySchema>;

/** `PATCH /guilds/:id/forum/:threadId/replies/:replyId`. */
export const UpdateHubForumReplySchema = CreateHubForumReplySchema;
export type UpdateHubForumReplyInput = z.infer<typeof UpdateHubForumReplySchema>;

/** `GET /guilds/:id/forum/latest` — the Overview widget. */
export const HubForumLatestSchema = z
  .object({
    threads: z.array(HubForumThreadSummarySchema).max(5),
    /** Live threads in the hub (the widget hides itself at 0). */
    total: z.number().int().nonnegative(),
  })
  .strict();
export type HubForumLatest = z.infer<typeof HubForumLatestSchema>;
