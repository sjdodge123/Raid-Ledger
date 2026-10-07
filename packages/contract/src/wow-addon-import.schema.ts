import { z } from 'zod';
// Via the barrel, never by file path (ROK-1733 moves these between files).
import {
    WowForeverRulesetSchema,
    WowForeverSelectableRulesetSchema,
} from './blizzard.schema.js';
import { WowRegionSchema } from './characters.schema.js';

// ============================================================
// WoW: Forever addon import — request / result / errors (ROK-1724)
// Route: POST /api/plugins/wow/characters/:id/addon-import
// ============================================================

/** Max pasted input (trimmed), in bytes — over it is `TOO_LARGE` (413). */
export const ADDON_IMPORT_MAX_BYTES = 262_144;
/** zlib `maxOutputLength` per page — over it is `DECODED_TOO_LARGE`. */
export const ADDON_IMPORT_MAX_DECODED_BYTES = 1_048_576;
/** Pages accepted for ONE guild export (`guild-<n>of<m>`, m ≤ 8). */
export const ADDON_IMPORT_MAX_PAGES = 8;
/**
 * Whitespace-separated tokens accepted in one paste (ROK-1737 "Export all"):
 * 8 guild pages + 1 char + 1 raid. Over it is `PAGES_INCOMPLETE`.
 */
export const ADDON_IMPORT_MAX_TOKENS = 10;
/**
 * Max spread of `exportedAt` (unix seconds) across the sections of one
 * mixed paste (ROK-1737). "Export all" stamps every section within a
 * second; 10 minutes still admits a player who exports the sections one by
 * one in the same sitting, while rejecting a stale string left over from an
 * earlier session being pasted beside fresh ones. Over it is
 * `INVALID_PAYLOAD`.
 */
export const ADDON_IMPORT_SAME_EXPORT_WINDOW_SECONDS = 600;

/**
 * One page token: `!RL<version>!<section>[-<n>of<m>]!<std base64>`.
 * Groups: 1 version · 2 section · 3 page n · 4 page count · 5 base64 body.
 * Shared so the web dialog's header chip and the API decoder agree.
 */
export const ADDON_IMPORT_PAGE_RE = /^!RL(\d+)!(char|guild|raid)(?:-(\d+)of(\d+))?!([A-Za-z0-9+/]+={0,2})$/;

export const AddonImportRequestSchema = z.object({
    importString: z.string().min(1).max(ADDON_IMPORT_MAX_BYTES),
    /** Preview by default; `false` applies. */
    dryRun: z.boolean().default(true),
    confirm: z.object({
        updateRuleset: z.boolean().optional(),
        repinGuid: z.boolean().optional(),
    }).strict().optional(),
}).strict();
export type AddonImportRequestDto = z.infer<typeof AddonImportRequestSchema>;
export type AddonImportRequestInput = z.input<typeof AddonImportRequestSchema>;

/**
 * ROK-1738 — body of the id-less create route
 * `POST /api/plugins/wow/characters/addon-import`. Same as
 * `AddonImportRequestSchema` plus the ruleset the user picked in the preview;
 * consulted only when the target is a `create` and the export carries no
 * ruleset (Hardcore is not selectable). The per-character route keeps the
 * strict `AddonImportRequestSchema`, which still rejects a `ruleset` key.
 */
export const AddonImportNewRequestSchema = AddonImportRequestSchema.extend({
    ruleset: WowForeverSelectableRulesetSchema.optional(),
}).strict();
export type AddonImportNewRequestDto = z.infer<typeof AddonImportNewRequestSchema>;
export type AddonImportNewRequestInput = z.input<typeof AddonImportNewRequestSchema>;

/** 413 `TOO_LARGE`, 429 `RATE_LIMITED`, everything else 422. */
export const AddonImportErrorCodeSchema = z.enum([
    'TOO_LARGE',
    'BAD_HEADER',
    'UNSUPPORTED_VERSION',
    'CUT_OFF',
    'DECODED_TOO_LARGE',
    'INVALID_PAYLOAD',
    'PAGES_INCOMPLETE',
    'WRONG_GAME',
    'REGION_MISMATCH',
    'NAME_MISMATCH',
    'NOT_IN_GUILD',
    'GUID_CONFIRM_REQUIRED',
    'RATE_LIMITED',
    /** ROK-1738 — create route: name + region already belong to another player. */
    'CHARACTER_CLAIMED',
    /** ROK-1738 — create route: the export has no ruleset and none was picked. */
    'RULESET_REQUIRED',
]);
export type AddonImportErrorCode = z.infer<typeof AddonImportErrorCodeSchema>;

/** Add Character prefill for the `NAME_MISMATCH` deep link (router state, Q6). */
export const AddonImportAddCharacterPrefillSchema = z.object({
    firstName: z.string(),
    secondName: z.string(),
    region: WowRegionSchema,
    ruleset: WowForeverRulesetSchema.nullable(),
    /** Title-cased display class, e.g. `Paladin`. */
    class: z.string(),
});
export type AddonImportAddCharacterPrefill = z.infer<typeof AddonImportAddCharacterPrefillSchema>;

export const AddonImportErrorBodySchema = z.object({
    code: AddonImportErrorCodeSchema,
    message: z.string(),
    /** Only on `NAME_MISMATCH`. */
    addCharacter: AddonImportAddCharacterPrefillSchema.optional(),
});
export type AddonImportErrorBody = z.infer<typeof AddonImportErrorBodySchema>;

export const AddonImportWarningCodeSchema = z.enum([
    'RULESET_CHANGED',
    'GUID_CHANGED',
    'STALE_EXPORT',
    'CLASS_LEVEL_UPDATED',
]);
export type AddonImportWarningCode = z.infer<typeof AddonImportWarningCodeSchema>;

const warningValue = z.union([z.string(), z.number(), z.null()]);

export const AddonImportWarningSchema = z.object({
    code: AddonImportWarningCodeSchema,
    from: warningValue.optional(),
    to: warningValue.optional(),
});
export type AddonImportWarning = z.infer<typeof AddonImportWarningSchema>;

export const AddonImportStatusSchema = z.enum(['preview', 'applied', 'noop', 'stale']);
export type AddonImportStatus = z.infer<typeof AddonImportStatusSchema>;

export const AddonImportDiffSchema = z.object({
    class: z.object({ from: z.string().nullable(), to: z.string() }).optional(),
    level: z.object({ from: z.number().int().nullable(), to: z.number().int() }).optional(),
});
export type AddonImportDiff = z.infer<typeof AddonImportDiffSchema>;

const n = z.number().int().nonnegative();

export const AddonCharImportSummarySchema = z.object({
    gearCount: n,
    /** Null when no gear row carried an item level. */
    avgIlvl: z.number().nullable(),
    talentNodes: n,
    lockouts: n,
});
export const AddonGuildImportSummarySchema = z.object({
    guildName: z.string(),
    members: n,
    newMembers: n,
    updatedMembers: n,
    pages: n,
});
export const AddonRaidImportSummarySchema = z.object({
    pulls: n,
    newPulls: n,
    duplicatePulls: n,
    kills: n,
    wipes: n,
});

const sectionBase = {
    status: AddonImportStatusSchema,
    /** Unix seconds from the payload. */
    exportedAt: z.number().int(),
};

/**
 * One section of a mixed "Export all" paste (ROK-1737): its own status
 * (a stale section writes nothing for that section) and counts.
 */
export const AddonImportSectionResultSchema = z.discriminatedUnion('section', [
    z.object({ ...sectionBase, section: z.literal('char'), summary: AddonCharImportSummarySchema }),
    z.object({ ...sectionBase, section: z.literal('guild'), summary: AddonGuildImportSummarySchema }),
    z.object({ ...sectionBase, section: z.literal('raid'), summary: AddonRaidImportSummarySchema }),
]);
export type AddonImportSectionResultDto = z.infer<typeof AddonImportSectionResultSchema>;

const resultBase = {
    ...sectionBase,
    warnings: z.array(AddonImportWarningSchema),
    diff: AddonImportDiffSchema,
    /**
     * ROK-1737 — present only for a paste with 2–3 sections, one entry per
     * section in canonical order char → guild → raid. The top-level
     * `section`/`status`/`exportedAt`/`summary` then mirror the FIRST entry,
     * and `warnings` carries `STALE_EXPORT` when ANY section is stale. A
     * single-section paste omits it (body unchanged since ROK-1724).
     */
    sections: z.array(AddonImportSectionResultSchema).min(2).max(3).optional(),
};

/** Discriminated by `section`; `summary` carries that section's counts. */
export const AddonImportResultSchema = z.discriminatedUnion('section', [
    z.object({ ...resultBase, section: z.literal('char'), summary: AddonCharImportSummarySchema }),
    z.object({ ...resultBase, section: z.literal('guild'), summary: AddonGuildImportSummarySchema }),
    z.object({ ...resultBase, section: z.literal('raid'), summary: AddonRaidImportSummarySchema }),
]);
export type AddonImportResultDto = z.infer<typeof AddonImportResultSchema>;

// ============================================================
// ROK-1738 — create-from-export route result
// ============================================================

export const AddonImportTargetActionSchema = z.enum(['create', 'update']);
export type AddonImportTargetAction = z.infer<typeof AddonImportTargetActionSchema>;

/** The character the create route resolved the export to. */
export const AddonImportTargetSchema = z.object({
    action: AddonImportTargetActionSchema,
    /** Null only on a `create` dry run (nothing written yet). */
    characterId: z.string().uuid().nullable(),
    name: z.string(),
    region: WowRegionSchema,
    /**
     * Null ONLY on a `create` target whose export has no ruleset — the web's
     * "show the ruleset picker" signal. An `update` target always carries the
     * stored ruleset.
     */
    ruleset: WowForeverRulesetSchema.nullable(),
    /** Title-cased display class, e.g. `Paladin`. */
    class: z.string(),
    level: z.number().int(),
});
export type AddonImportTargetDto = z.infer<typeof AddonImportTargetSchema>;

/** The ROK-1724 result plus the resolved `target`. */
export const AddonImportNewResultSchema = AddonImportResultSchema.and(
    z.object({ target: AddonImportTargetSchema }),
);
export type AddonImportNewResultDto = z.infer<typeof AddonImportNewResultSchema>;
