import { z } from 'zod';
import { CompanionTimestampSchema } from './companion-common.schema.js';
import { DEV_BRIDGE_PAGE_MAX_BYTES, devBridgeMaxBytes, DevBridgeNextSchema } from './companion-dev-bridge.schema.js';

// ============================================================
// Companion dev bridge v1 — collector status + structured activity events
// (2026-11-06, additive). GET /dev/v1/collectors rows gain `status`, the body a device-level `linked`;
// GET /dev/v1/events is the allowlisted replacement for the removed
// Activity-log mirror. NO free text anywhere: every field is an enum, a
// number, a timestamp or a tight lowercase token — never a message, a path
// or a name (free-text scrubbing leaked paths in four review rounds).
// ============================================================

/** A collector id (`wow-ledgerlink`, `bg3-save`, …): a code-defined built-in id, never user data. */
export const DevBridgeCollectorIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/**
 * The state the Companion window's collector tile shows (its status line),
 * as a closed enum. A device-level state that blocks every collector wins
 * over the collector's own line (`paused` > `rate-limited` > `link-device`).
 * Meanings: CONTRACT.md § Collector status.
 */
export const DEV_BRIDGE_COLLECTOR_STATUSES = [
    'off',
    'paused',
    'rate-limited',
    'link-device',
    'not-scanned',
    'no-files',
    'needs-confirm',
    'waiting',
    'up-to-date',
    'uploaded',
    'rejected',
    'retrying',
    'error',
] as const;
export const DevBridgeCollectorStatusSchema = z.enum(DEV_BRIDGE_COLLECTOR_STATUSES);

/** What happened. Meanings: CONTRACT.md § Activity events. */
export const DEV_BRIDGE_EVENT_KINDS = [
    'scan',
    'upload-ok',
    'upload-rejected',
    'upload-held',
    'upload-retry',
    'link-required',
    'collector-on',
    'collector-off',
    'error',
] as const;
export const DevBridgeEventKindSchema = z.enum(DEV_BRIDGE_EVENT_KINDS);

/** A machine error code (the server's rejection `code`, or the companion's own) — a token, never a message. */
/**
 * The codes an upload outcome can carry, from rl-companion's upload paths
 * (apps/companion/src-tauri/src/upload.rs): the server's terminal content
 * codes (TERMINAL_CODES), the Gallery-full code, the blob refusals, the
 * companion's own `blob_refused`, and the "contract not served" codes.
 * Any other server code — and anything else — is sent as `other`.
 * Mapping rule: CONTRACT.md § Activity events.
 */
export const DEV_BRIDGE_EVENT_ERROR_CODES = [
    'invalid_envelope',
    'invalid_payload',
    'payload_too_large',
    'captured_at_in_future',
    'blob_quota_exceeded',
    'invalid_blob',
    'hash_mismatch',
    'unsupported_media',
    'blob_ref_mismatch',
    'blob_refused',
    'unknown_contract',
    'unknown_contract_version',
    'retired_contract_version',
    'other',
] as const;
export const DevBridgeEventErrorCodeSchema = z.enum(DEV_BRIDGE_EVENT_ERROR_CODES);

/** One structured companion activity event. Strict: an unknown key (e.g. a `message`) is rejected. */
export const DevBridgeEventSchema = z
    .object({
        ts: CompanionTimestampSchema,
        collectorId: DevBridgeCollectorIdSchema,
        kind: DevBridgeEventKindSchema,
        /** Items the event covers (files scanned, exports uploaded / held). */
        count: z.number().int().min(0).max(1_000_000).optional(),
        /** The server's HTTP status, for an upload outcome. */
        httpStatus: z.number().int().min(100).max(599).optional(),
        errorCode: DevBridgeEventErrorCodeSchema.optional(),
    })
    .strict();

/** GET /dev/v1/events?since=&cursor= — oldest first; paged by the 16 KiB body cap (the only row bound). */
export const DevBridgeEventsSchema = z
    .object({ events: z.array(DevBridgeEventSchema), next: DevBridgeNextSchema })
    .strict()
    .superRefine(devBridgeMaxBytes(DEV_BRIDGE_PAGE_MAX_BYTES, 'Response body'));

export type DevBridgeCollectorStatus = z.output<typeof DevBridgeCollectorStatusSchema>;
export type DevBridgeEventKind = z.output<typeof DevBridgeEventKindSchema>;
export type DevBridgeEventErrorCode = z.output<typeof DevBridgeEventErrorCodeSchema>;
export type DevBridgeEvent = z.output<typeof DevBridgeEventSchema>;
export type DevBridgeEvents = z.output<typeof DevBridgeEventsSchema>;
