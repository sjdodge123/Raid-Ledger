import { z } from 'zod';
import {
    COMPANION_MESSAGE_MAX_BYTES,
    CompanionSha256Schema,
    CompanionTimestampSchema,
    companionDisplayTextSchema,
    rejectLoneSurrogates,
} from './companion-common.schema.js';
import { companionEnvelopeShape } from './companion-envelope.schema.js';

// ============================================================
// `wow-addon-errors` v1 (ROK-2099) — `companion/wow-addon-errors/v1/`.
//
// Addon errors the Companion reads from a player's `!BugGrabber.lua`
// SavedVariables, parsed and SCRUBBED on the PC (CONTRACT.md §4) and pushed
// as records — never the raw file (operator ruling 5). Rulings 2026-11-19:
// BugGrabber is the only source; the reporter is the uploader's own
// character + realm; BugGrabber `locals` are never sent (no such field, so
// strict keys reject it); a home-folder or drive-letter path left in any
// string is REFUSED here, so a scrub bug fails loud in the Companion's CI.
// ============================================================

/** Registry id and version of this contract. */
export const WOW_ADDON_ERRORS_CONTRACT_ID = 'wow-addon-errors';
export const WOW_ADDON_ERRORS_CONTRACT_VERSION = 1;

/** Decoded JSON body cap for a `wow-addon-errors` v1 message: the global ceiling. */
export const COMPANION_WOW_ADDON_ERRORS_MAX_BYTES = COMPANION_MESSAGE_MAX_BYTES;

/** Most records in one message; the collector splits a bigger batch. */
export const WOW_ADDON_ERRORS_RECORDS_MAX = 50;
/** Longest addon folder name a record points at. */
export const WOW_ADDON_ERRORS_ADDON_MAX = 64;
/** Longest scrubbed error message. */
export const WOW_ADDON_ERRORS_MESSAGE_MAX = 1024;
/** Longest scrubbed stack (the collector truncates with a `…[truncated]` marker). */
export const WOW_ADDON_ERRORS_STACK_MAX = 4096;
/** Highest per-record occurrence count. */
export const WOW_ADDON_ERRORS_COUNT_MAX = 1_000_000;
/** Highest BugGrabber session number (Postgres int4). */
export const WOW_ADDON_ERRORS_SESSION_MAX = 2_147_483_647;

/**
 * An UNSCRUBBED path: a drive letter + colon + slash/backslash that does not
 * follow a letter or digit (so `https://` passes), or a `Users` folder segment
 * between separators. No lookaround, so Rust's `regex` crate compiles it too.
 * The scrubbed forms (`<home>\`, `<wow>\`, `Interface\AddOns\…`) never match.
 */
export const WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE = /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]|[\\/][Uu][Ss][Ee][Rr][Ss][\\/]/;

/** Multi-line text: tab, LF and CR allowed; NUL and other C0 controls and DEL refused. */
const MULTILINE_TEXT_RE = /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+$/;

/** Zod `superRefine` refusing an unscrubbed path (the published schema carries it as `not.pattern`). */
function rejectUnscrubbedPath(value: string, ctx: z.RefinementCtx): void {
    if (!WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE.test(value)) return;
    ctx.addIssue({
        code: 'invalid_format',
        format: 'regex',
        pattern: WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE.toString(),
        message: 'Unscrubbed path: replace the home folder with <home> and the WoW folder with <wow>',
    });
}

/** Scrubbed free text, 1..`maxChars` UTF-16 units; may span lines. */
function scrubbedTextSchema(maxChars: number) {
    return z
        .string()
        .min(1)
        .max(maxChars)
        .regex(MULTILINE_TEXT_RE)
        .superRefine(rejectLoneSurrogates)
        .superRefine(rejectUnscrubbedPath)
        .meta({ not: { pattern: WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE.source } });
}

/** One-line display text that must also be path-free. */
function scrubbedLineSchema(maxChars: number) {
    return companionDisplayTextSchema(maxChars)
        .superRefine(rejectUnscrubbedPath)
        .meta({ not: { pattern: WOW_ADDON_ERRORS_UNSCRUBBED_PATH_RE.source } });
}

/** The uploader's OWN character for this file (ruling 6); never another player's. */
export const WowAddonErrorsCharacterSchema = z.object({
    name: companionDisplayTextSchema(24),
    realm: companionDisplayTextSchema(48),
}).strict();

/** One de-duplicated BugGrabber error, already scrubbed by the collector. */
export const WowAddonErrorRecordSchema = z.object({
    /** The addon the error points at (first `AddOns\<Name>\` segment), not the source addon. */
    addon: scrubbedLineSchema(WOW_ADDON_ERRORS_ADDON_MAX),
    message: scrubbedTextSchema(WOW_ADDON_ERRORS_MESSAGE_MAX),
    stack: scrubbedTextSchema(WOW_ADDON_ERRORS_STACK_MAX).optional(),
    firstSeenAt: CompanionTimestampSchema,
    lastSeenAt: CompanionTimestampSchema,
    count: z.number().int().min(1).max(WOW_ADDON_ERRORS_COUNT_MAX),
    session: z.number().int().min(0).max(WOW_ADDON_ERRORS_SESSION_MAX).optional(),
}).strict().superRefine((rec, ctx) => {
    if (Date.parse(rec.firstSeenAt) <= Date.parse(rec.lastSeenAt)) return;
    ctx.addIssue({ code: 'custom', path: ['firstSeenAt'], message: 'firstSeenAt must be <= lastSeenAt' });
});
export type WowAddonErrorRecord = z.infer<typeof WowAddonErrorRecordSchema>;

/** Records must be unique by (addon, message, stack) within one message. */
function rejectDuplicateRecords(records: readonly WowAddonErrorRecord[], ctx: z.RefinementCtx): void {
    const seen = new Set<string>();
    records.forEach((rec, i) => {
        const key = JSON.stringify([rec.addon, rec.message, rec.stack ?? null]);
        if (!seen.has(key)) {
            seen.add(key);
            return;
        }
        ctx.addIssue({ code: 'custom', path: [i], message: 'Duplicate record (addon, message, stack)' });
    });
}

/** The payload: one scrubbed batch from one account's BugGrabber file. */
export const WowAddonErrorsPayloadSchema = z.object({
    source: z.enum(['buggrabber']),
    /** The source addon's version from its `.toc`, e.g. `12.1.1`. */
    sourceVersion: scrubbedLineSchema(32),
    /** SHA-256 of the `WTF/Account/<folder>` name — never the raw name (README rule 6). */
    accountKey: CompanionSha256Schema,
    characterHint: WowAddonErrorsCharacterSchema.optional(),
    /** The WoW install flavour folder, e.g. `_classic_era_`. */
    wowFlavor: z.string().regex(/^[A-Za-z0-9_]{1,32}$/).optional(),
    records: z
        .array(WowAddonErrorRecordSchema)
        .min(1)
        .max(WOW_ADDON_ERRORS_RECORDS_MAX)
        .superRefine(rejectDuplicateRecords),
}).strict();
export type WowAddonErrorsPayload = z.infer<typeof WowAddonErrorsPayloadSchema>;

/** Full `wow-addon-errors` v1 message: the envelope with literals + the strict payload. */
export const WowAddonErrorsMessageSchema = z.object({
    ...companionEnvelopeShape,
    contract: z.literal(WOW_ADDON_ERRORS_CONTRACT_ID),
    contractVersion: z.literal(WOW_ADDON_ERRORS_CONTRACT_VERSION),
    payload: WowAddonErrorsPayloadSchema,
}).strict();
export type WowAddonErrorsMessage = z.infer<typeof WowAddonErrorsMessageSchema>;
