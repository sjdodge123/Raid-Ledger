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
 * Global decoded-body ceiling, applied by the reader BEFORE any JSON parse
 * (the per-contract cap needs `contractVersion`, which is in the body). Every
 * registry `maxBytes` must be <= this (registry spec R5).
 */
export const COMPANION_MESSAGE_MAX_BYTES = 262_144;

/**
 * Decoded JSON body cap for a `bg3-save` v1 message, checked after the
 * envelope parses. It is >= the LARGEST schema-valid message (every array
 * full, every string at max length; engine ids are ASCII and `saveName`
 * adds < 1 KB in the worst case), so the array caps bind first.
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

/**
 * Display-safe free text: no C0/C1 controls (so no NUL or line breaks), no
 * U+2028/2029, no bidi embeddings/overrides/isolates, and not whitespace-only.
 * Lone surrogates are rejected separately by `rejectLoneSurrogates` — Rust's
 * `regex` crate cannot compile `\p{Cs}`, so it stays out of the published
 * JSON-schema pattern (ROK-2034). Pair the two wherever this pattern is used.
 */
export const COMPANION_DISPLAY_TEXT_RE = /^(?!\s*$)[^\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]+$/u;

/** A UTF-16 lone surrogate. Only JS strings can hold one; Postgres/UTF-8 cannot store it. */
export const COMPANION_LONE_SURROGATE_RE = /\p{Cs}/u;

/**
 * Zod `superRefine` for display text: rejects lone surrogates with the same
 * `invalid_format` issue the regex raises. A refinement is not emitted into
 * the generated JSON schema, so non-JS validators never see `\p{Cs}`.
 */
export function rejectLoneSurrogates(value: string, ctx: z.RefinementCtx): void {
    if (!COMPANION_LONE_SURROGATE_RE.test(value)) return;
    ctx.addIssue({
        code: 'invalid_format',
        format: 'regex',
        pattern: COMPANION_LONE_SURROGATE_RE.toString(),
        message: 'Must not contain a lone surrogate',
    });
}

/** Free text a user authored and other hub members will see, 1..`maxChars` UTF-16 units. */
export function companionDisplayTextSchema(maxChars: number): z.ZodString {
    return z.string().min(1).max(maxChars).regex(COMPANION_DISPLAY_TEXT_RE).superRefine(rejectLoneSurrogates);
}
