import { z } from 'zod';

/**
 * ROK-1942 — the shared hub media store behind the hub Gallery widget.
 *
 * Every picture records its source `kind` (operator ruling 2026-10-24): a
 * death post, another game screenshot, or a plain image. The gallery's
 * All · Deaths · Screenshots chips filter on it, and the list response says
 * which kinds a hub actually has so the web never offers an empty chip.
 * ROK-1965 adds `upload` — a picture a member added from the Gallery; it
 * sits under the Screenshots chip.
 */
export const HUB_MEDIA_KINDS = ['death', 'screenshot', 'image', 'upload'] as const;
export const HubMediaKindSchema = z.enum(HUB_MEDIA_KINDS);
export type HubMediaKind = z.infer<typeof HubMediaKindSchema>;

/** Where a picture came from: a Discord post, or a member upload (ROK-1965). */
export const HUB_MEDIA_SOURCES = ['discord', 'upload'] as const;
export const HubMediaSourceSchema = z.enum(HUB_MEDIA_SOURCES);
export type HubMediaSource = z.infer<typeof HubMediaSourceSchema>;

/**
 * ROK-1965 — largest raw file `POST /hubs/:guildId/media` accepts (nginx
 * caps bodies at 10m). The web shrinks a bigger pick before sending.
 */
export const HUB_MEDIA_UPLOAD_MAX_BYTES = 9 * 1024 * 1024;

/** File types the web offers to upload; the server re-checks magic bytes. */
export const HUB_MEDIA_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type HubMediaUploadType = (typeof HUB_MEDIA_UPLOAD_TYPES)[number];

/** The `code` on an upload error body, so the web maps copy without string-matching. */
export const HUB_MEDIA_UPLOAD_ERROR_CODES = [
    'not_image',
    'too_large',
    'cap',
    'removed',
    'rate_limited',
    'busy',
] as const;
export const HubMediaUploadErrorCodeSchema = z.enum(HUB_MEDIA_UPLOAD_ERROR_CODES);
export type HubMediaUploadErrorCode = z.infer<typeof HubMediaUploadErrorCodeSchema>;

/** Largest page the list route serves (the widget asks 8, the dialog 24). */
export const HUB_MEDIA_PAGE_MAX = 48;

/** The two stored renditions; the bytes route takes one as `:variant`. */
export const HUB_MEDIA_VARIANTS = ['full', 'thumb'] as const;
export const HubMediaVariantSchema = z.enum(HUB_MEDIA_VARIANTS);
export type HubMediaVariant = z.infer<typeof HubMediaVariantSchema>;

/**
 * A decorator link's `href` is rendered as an `<a href>`, so only a same-site
 * path (`/…`, never protocol-relative `//…` or `/\\…`) or an absolute
 * `https:` URL passes — never `javascript:`, `data:` or `http:`.
 */
export function isSafeHubMediaHref(href: string): boolean {
    if (href.startsWith('/')) return !href.startsWith('//') && !href.startsWith('/\\');
    try {
        return new URL(href).protocol === 'https:';
    } catch {
        return false;
    }
}

export const HubMediaItemSchema = z
    .object({
        id: z.number().int().positive(),
        kind: HubMediaKindSchema,
        authorName: z.string().max(64).nullable(),
        caption: z.string().max(200).nullable(),
        capturedAt: z.string().datetime(),
        width: z.number().int(),
        height: z.number().int(),
        /** API paths, fetched with the bearer token (never a public URL). */
        thumbPath: z.string(),
        fullPath: z.string(),
        source: z.object({
            type: HubMediaSourceSchema,
            label: z.string().max(100).nullable(),
        }),
        link: z
            .object({
                label: z.string().max(40),
                href: z.string().max(300).refine(isSafeHubMediaHref, {
                    message: 'A picture link is a same-site path or an https: URL',
                }),
            })
            .nullable(),
        /** Only ever true for editors — members never receive hidden rows. */
        hidden: z.boolean(),
        /**
         * ROK-1965 — this viewer may remove the picture (the hub's leader, or
         * the member who uploaded it). Computed server-side per viewer.
         */
        canRemove: z.boolean(),
    })
    .strict();
export type HubMediaItem = z.infer<typeof HubMediaItemSchema>;

/**
 * ROK-2027 — a plugin-resolved Gallery scope, `<namespace>:<payload>` (e.g.
 * `valheim-death:c42`). The payload is the owning plugin's opaque key; it
 * may hold inner spaces (a character name) but never edge whitespace or a
 * line break.
 */
export const HUB_MEDIA_SUBJECT_RE = /^[a-z][a-z0-9-]{0,31}:\S(?:.{0,98}\S)?$/;

export const HubMediaListQuerySchema = z.object({
    kind: HubMediaKindSchema.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(HUB_MEDIA_PAGE_MAX).optional(),
    /** ROK-2027 — narrow to one plugin-resolved subject (`HUB_MEDIA_SUBJECT_RE`). */
    subject: z.string().max(140).regex(HUB_MEDIA_SUBJECT_RE).optional(),
});
export type HubMediaListQuery = z.infer<typeof HubMediaListQuerySchema>;

export const HubMediaListResponseSchema = z.object({
    items: z.array(HubMediaItemSchema),
    nextCursor: z.string().nullable(),
    /** Visible pictures matching the request's `kind` AND `subject` filters. */
    total: z.number().int().nonnegative(),
    /** Kinds present on this hub (for this viewer), for the filter chips. */
    kinds: z.array(HubMediaKindSchema),
});
export type HubMediaListResponse = z.infer<typeof HubMediaListResponseSchema>;

export const HubMediaHideBodySchema = z.object({ hidden: z.boolean() }).strict();
export type HubMediaHideBody = z.infer<typeof HubMediaHideBodySchema>;
