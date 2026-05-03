/**
 * Public-shareable lineup contract (ROK-1067).
 *
 * The public read endpoint (`GET /api/lineups/public/:slug`) is reachable
 * without authentication. Its response is intentionally narrow — only the
 * five fields below — so a future refactor of the auth'd lineup detail
 * endpoint cannot accidentally leak voter/nominee/invitee data.
 *
 * `PublicLineupResponseSchema` is `.strict()`: the controller calls
 * `.parse()` on the service output before returning, and any extra key
 * surfaces a runtime error in tests + dev. See architect finding #4.
 */
import { z } from 'zod';
import { LineupStatusSchema } from './lineup.schema.js';

/**
 * Slug constraint: URL-safe nanoid. Generation uses 12 chars from a 64-char
 * alphabet (~72 bits of entropy). Range 12–16 leaves room for future-vanity
 * slugs without breaking the regex.
 */
export const PublicLineupSlugSchema = z
    .string()
    .min(12)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/);

export const PublicLineupParamsSchema = z.object({
    slug: PublicLineupSlugSchema,
});

export type PublicLineupParamsDto = z.infer<typeof PublicLineupParamsSchema>;

/** Decision block — only populated when status === 'decided'. */
export const PublicLineupDecisionSchema = z.object({
    gameName: z.string(),
    coverUrl: z.string().nullable(),
});

export type PublicLineupDecisionDto = z.infer<typeof PublicLineupDecisionSchema>;

/**
 * Sanitized public response — NEVER includes voters, votes, nominees,
 * invitees, voterIds, internal ids, or createdBy. The schema is `.strict()`
 * so any drift in the service projection fails parse at the controller.
 */
export const PublicLineupResponseSchema = z
    .object({
        title: z.string(),
        description: z.string().nullable(),
        status: LineupStatusSchema,
        decision: PublicLineupDecisionSchema.nullable(),
        communityName: z.string(),
    })
    .strict();

export type PublicLineupResponseDto = z.infer<typeof PublicLineupResponseSchema>;

/** Body for `PATCH /lineups/:id/public-share`. */
export const TogglePublicShareSchema = z.object({
    enabled: z.boolean(),
});

export type TogglePublicShareDto = z.infer<typeof TogglePublicShareSchema>;
