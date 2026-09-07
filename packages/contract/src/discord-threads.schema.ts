import { z } from 'zod';

/**
 * ROK-1483 — the read-only Discord thread mirror.
 *
 * Every shape here describes rows the API has ALREADY mirrored into Postgres.
 * Nothing on this wire is fetched from Discord on the request path (D1), so a
 * response is a pure database read even when the bot is offline.
 */

/**
 * The kinds of app surface a mirrored thread can hang off (D2).
 *
 * An enum rather than a free string so an unknown surface is a 400 at the
 * boundary instead of a silently empty result. ROK-1484 extends THIS and
 * nothing else when it adds lineups / polls / events.
 */
export const ThreadSurfaceKindSchema = z.enum(['lfg-group']);
export type ThreadSurfaceKind = z.infer<typeof ThreadSurfaceKindSchema>;

/**
 * A surface reference — the `(kind, id)` pair a caller claims a thread belongs
 * to. `id` is a string even though `lfg-group`'s id is a numeric game id:
 * ROK-1484's lineup and poll ids are uuids, and a union on the wire would make
 * every consumer narrow before it could render.
 */
export const ThreadSurfaceRefSchema = z.object({
    kind: ThreadSurfaceKindSchema,
    id: z.string().min(1),
});
export type ThreadSurfaceRef = z.infer<typeof ThreadSurfaceRefSchema>;

/**
 * The author of a mirrored message, frozen at post time.
 *
 * `avatarUrl` is a RESOLVED absolute CDN url, not the stored avatar hash — the
 * web app never learns Discord's url format. Null means "no avatar hash was
 * recorded"; the viewer falls back to initials.
 */
export const ThreadMessageAuthorSchema = z.object({
    discordUserId: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().url().nullable(),
});
export type ThreadMessageAuthorDto = z.infer<typeof ThreadMessageAuthorSchema>;

/**
 * One attachment on a mirrored message.
 *
 * Discord attachment urls have been signed since 2024 and 403 after roughly a
 * day (A11) — the filename is the durable part, "Open in Discord" is the
 * durable path. This is a known, accepted degradation.
 */
export const ThreadMessageAttachmentSchema = z.object({
    name: z.string(),
    url: z.string().url(),
});
export type ThreadMessageAttachmentDto = z.infer<typeof ThreadMessageAttachmentSchema>;

/**
 * A mention resolved at WRITE time (D8).
 *
 * The conversation is a historical record, so a rename three months later must
 * not rewrite it. Storing the display name also keeps the read path free of
 * both Discord calls and an N+1 into `users`.
 */
export const ThreadMessageMentionSchema = z.object({
    id: z.string(),
    kind: z.enum(['user', 'role', 'channel']),
    displayName: z.string(),
});
export type ThreadMessageMentionDto = z.infer<typeof ThreadMessageMentionSchema>;

/**
 * One mirrored message.
 *
 * There is deliberately no `deleted` field (D10): a soft-deleted row is omitted
 * from the response entirely. `content` is the VERBATIM Discord content string,
 * still carrying raw `<@123>` markers — substitution happens in the viewer
 * using `mentions`, so the server never has to guess at render policy.
 */
export const ThreadMessageSchema = z.object({
    messageId: z.string(),
    author: ThreadMessageAuthorSchema,
    content: z.string(),
    attachments: z.array(ThreadMessageAttachmentSchema),
    mentions: z.array(ThreadMessageMentionSchema),
    /** ISO timestamp of the original Discord message. */
    createdAt: z.string(),
    /** ISO timestamp of the last edit, or null when never edited. */
    editedAt: z.string().nullable(),
});
export type ThreadMessageDto = z.infer<typeof ThreadMessageSchema>;

/**
 * Query of `GET /discord/threads/:threadId/messages`.
 *
 * `surfaceKind` + `surfaceId` are the caller's CLAIM, never the authority (D3):
 * the server resolves the thread's real surface and 403s a mismatch. `before`
 * pages backwards only — there is no `after`, because a forward delta can never
 * observe an edit or a delete to an already-fetched message (D11 / A4).
 */
export const ThreadMessagesQuerySchema = z.object({
    surfaceKind: ThreadSurfaceKindSchema,
    surfaceId: z.string().min(1),
    /**
     * Exclusive `messageId` cursor — returns messages OLDER than this one.
     *
     * Constrained to a Discord snowflake (17–20 digits) because the server
     * feeds this straight into `BigInt()` to derive `sort_key`: an unconstrained
     * string makes `?before=abc` an uncaught 500 instead of the 400 the error
     * matrix promises, and `?before=` silently coerces to `0n` and returns an
     * empty page. Snowflakes cannot be shorter than 17 digits — the Discord
     * epoch puts the timestamp in the high bits — so this rejects nothing real.
     */
    before: z
        .string()
        .regex(/^\d{17,20}$/, 'before must be a Discord message id')
        .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ThreadMessagesQueryDto = z.infer<typeof ThreadMessagesQuerySchema>;

/** Response of `GET /discord/threads/:threadId/messages`. */
export const ThreadMessagesResponseSchema = z.object({
    threadId: z.string(),
    surface: ThreadSurfaceRefSchema,
    /** ASCENDING by snowflake (oldest first) — this is render order. */
    messages: z.array(ThreadMessageSchema),
    /** True when older messages exist before `messages[0]`. */
    hasMore: z.boolean(),
    /** Null when the guild is unknown or the thread is gone from Discord (D12). */
    threadUrl: z.string().url().nullable(),
    archived: z.boolean(),
});
export type ThreadMessagesResponseDto = z.infer<typeof ThreadMessagesResponseSchema>;
