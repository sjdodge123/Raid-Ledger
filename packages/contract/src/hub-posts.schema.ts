import { z } from 'zod';
import {
  findHubPostMarkdownViolation,
  HUB_POST_MARKDOWN_MESSAGES,
} from './hub-post-markdown.js';

/**
 * Hub leader posts (ROK-1868) — a post feed replacing the single GM post
 * field. Lives in the shared hub shell, so every hub kind inherits it.
 *
 * Bodies are markdown source in the hub-post subset (`hub-post-markdown.ts`),
 * authored in a WYSIWYG editor; the length cap counts SOURCE characters.
 */

const id = z.number().int().positive();
const isoDate = z.iso.datetime({ offset: true });

export const HUB_POST_BODY_MAX = 4000;
export const HUB_POST_PAGE_DEFAULT = 10;
export const HUB_POST_PAGE_MAX = 50;

/** A person on a post; null fields once the user is wiped (SET NULL). */
export const HubPostPersonSchema = z
  .object({
    userId: id.nullable(),
    displayName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  })
  .strict();
export type HubPostPerson = z.infer<typeof HubPostPersonSchema>;

export const HubPostRelaySchema = z
  .object({
    channelId: z.string(),
    /** `https://discord.com/channels/<guild>/<channel>/<message>`; null when the bot's guild id is unknown. */
    messageUrl: z.string().url().nullable(),
    relayedAt: isoDate,
  })
  .strict();
export type HubPostRelay = z.infer<typeof HubPostRelaySchema>;

export const HubPostSchema = z
  .object({
    id,
    guildId: id,
    /** Markdown source. NOT re-validated on read — legacy backfilled bodies are plain text. */
    body: z.string().min(1).max(HUB_POST_BODY_MAX),
    author: HubPostPersonSchema,
    createdAt: isoDate,
    updatedAt: isoDate,
    /** Null until a PATCH changes the body (the "Edited" marker). */
    editedBy: HubPostPersonSchema.nullable(),
    relay: HubPostRelaySchema.nullable(),
  })
  .strict();
export type HubPost = z.infer<typeof HubPostSchema>;

/** `GET /guilds/:id/posts` — newest first, cursor-paged. */
export const HubPostListQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(HUB_POST_PAGE_MAX)
      .default(HUB_POST_PAGE_DEFAULT),
  })
  .strict();
export type HubPostListQuery = z.infer<typeof HubPostListQuerySchema>;

export const HubPostListSchema = z
  .object({ posts: z.array(HubPostSchema), nextCursor: z.string().nullable() })
  .strict();
export type HubPostList = z.infer<typeof HubPostListSchema>;

/** Write-side body: trimmed, 1..4000 source chars, inside the markdown subset. */
export const HubPostBodyInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(HUB_POST_BODY_MAX)
  .superRefine((body, ctx) => {
    const violation = findHubPostMarkdownViolation(body);
    if (violation) {
      ctx.addIssue({ code: 'custom', message: HUB_POST_MARKDOWN_MESSAGES[violation] });
    }
  });

/** `POST /guilds/:id/posts`. */
export const CreateHubPostSchema = z
  .object({ body: HubPostBodyInputSchema, relayToDiscord: z.boolean() })
  .strict();
export type CreateHubPostInput = z.infer<typeof CreateHubPostSchema>;

/** `PATCH /guilds/:id/posts/:postId` — edits never re-send to Discord. */
export const UpdateHubPostSchema = z.object({ body: HubPostBodyInputSchema }).strict();
export type UpdateHubPostInput = z.infer<typeof UpdateHubPostSchema>;

export const HubPostRelayOutcomeSchema = z.enum([
  'sent',
  'failed',
  'not_requested',
  'unavailable',
]);
export type HubPostRelayOutcome = z.infer<typeof HubPostRelayOutcomeSchema>;

export const CreateHubPostResponseSchema = z
  .object({ post: HubPostSchema, relayOutcome: HubPostRelayOutcomeSchema })
  .strict();
export type CreateHubPostResponse = z.infer<typeof CreateHubPostResponseSchema>;

/** Where a relayed post would go, and why it can't when it can't. */
export const HubPostRelayChannelSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), channelId: z.string(), channelName: z.string() }),
  z.object({ state: z.literal('unset') }),
  z.object({ state: z.literal('disconnected') }),
  z.object({
    state: z.literal('no-permission'),
    channelId: z.string(),
    channelName: z.string().nullable(),
  }),
  z.object({ state: z.literal('gone'), channelId: z.string() }),
]);
export type HubPostRelayChannel = z.infer<typeof HubPostRelayChannelSchema>;

/** `GET /guilds/:id/posts/composer` — the remembered relay default + channel state. */
export const HubPostComposerSchema = z
  .object({ relayDefault: z.boolean(), channel: HubPostRelayChannelSchema })
  .strict();
export type HubPostComposer = z.infer<typeof HubPostComposerSchema>;
