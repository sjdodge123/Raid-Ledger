import { z } from 'zod';

/**
 * ROK-1667 (RH-1a) — relay hub v1 envelope: schema version, ids, cursors
 * and the error body every hub endpoint returns on failure.
 *
 * Versioning (relay-hub scope §3.1): changes within v1 are additive only.
 * Reader-side enums carry `'unknown'` and `.catch('unknown')`, so a newer
 * hub's value degrades instead of failing an older reader.
 */

/** The hub API's current `schemaVersion`. */
export const HUB_SCHEMA_VERSION = 1 as const;

/** The hub's own game id (ULID). */
export const RlGameIdSchema = z.ulid();

export type RlGameId = z.infer<typeof RlGameIdSchema>;

/** Opaque feed cursor. */
export const HubCursorSchema = z.string().min(1).max(200);

export type HubCursor = z.infer<typeof HubCursorSchema>;

export const HubErrorCodeSchema = z
  .enum([
    'enrollment_required',
    'enrollment_invalid',
    'not_contributor',
    'revoked',
    'schema_unsupported',
    'rate_limited',
    'validation_failed',
    'unknown',
  ])
  .catch('unknown');

export type HubErrorCode = z.infer<typeof HubErrorCodeSchema>;

export const HubErrorSchema = z.object({
  error: HubErrorCodeSchema,
  message: z.string().optional(),
});

export type HubError = z.infer<typeof HubErrorSchema>;
