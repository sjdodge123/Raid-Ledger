import { z } from 'zod';

// ============================================================
// Raid Ledger Companion wire contracts — shared primitives (ROK-1954)
//
// The desktop Companion app (and its Rust collectors) PUSH messages to
// `POST /companion/v1/messages/:contract`. Raid Ledger owns the format:
// `packages/contract/companion/README.md` + `companion/<name>/vN/`.
// EVERY wire object is `.strict()` — an unknown key rejects the message.
// These primitives are defined apart from the Valheim ones on purpose, so
// the two contracts can evolve independently.
// ============================================================

/** `envelopeVersion` every v1 envelope carries. */
export const COMPANION_ENVELOPE_VERSION = 1;

/** Longest `capturedAt`/`savedAt` string: `YYYY-MM-DDTHH:MM:SS.sssZ`. */
export const COMPANION_TIMESTAMP_MAX_CHARS = 24;

/**
 * How far past the server clock a `capturedAt` may be. Not checkable in Zod
 * (no clock); the ingest endpoint (ROK C3) rejects anything later.
 */
export const COMPANION_CAPTURED_AT_MAX_FUTURE_MS = 300_000;

/**
 * Decoded JSON body cap for a `bg3-save` v1 message. It is >= the LARGEST
 * schema-valid message (every array full, every string at max length; BG3
 * ids are ASCII so no 6-byte escapes arise), so the array caps bind first.
 */
export const COMPANION_BG3_SAVE_MAX_BYTES = 65_536;

/** Cap for one uploaded WebP blob (the sample thumbnail is ~41 KB). */
export const COMPANION_WEBP_MAX_BYTES = 1_048_576;

/** Largest image edge, in pixels, a blob ref may declare. */
export const COMPANION_IMAGE_EDGE_MAX = 4096;

/** Longest app / collector version string (semver core + pre-release). */
export const COMPANION_VERSION_MAX_CHARS = 48;

/**
 * ISO-8601 UTC instant with a `Z` offset, e.g. `2026-10-24T12:00:05Z`; at
 * most millisecond precision (the length cap enforces it).
 */
export const CompanionTimestampSchema = z.iso.datetime().max(COMPANION_TIMESTAMP_MAX_CHARS);

/** Lowercase hex SHA-256 of a separately uploaded blob. */
export const CompanionSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** `MAJOR.MINOR.PATCH` with an optional pre-release tag, e.g. `1.2.3-beta.1`. */
export const CompanionVersionStringSchema = z
    .string()
    .max(COMPANION_VERSION_MAX_CHARS)
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,32})?$/);

/**
 * Reference to a WebP the app uploads separately (`PUT /companion/v1/blobs/:sha256`).
 * The server checks the VP8/VP8L/VP8X header against `width`/`height` before decode.
 */
export const CompanionWebpRefSchema = z.object({
    sha256: CompanionSha256Schema,
    byteLength: z.number().int().positive().max(COMPANION_WEBP_MAX_BYTES),
    contentType: z.literal('image/webp'),
    width: z.number().int().positive().max(COMPANION_IMAGE_EDGE_MAX),
    height: z.number().int().positive().max(COMPANION_IMAGE_EDGE_MAX),
}).strict();
export type CompanionWebpRef = z.infer<typeof CompanionWebpRefSchema>;
