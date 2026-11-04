import { z } from 'zod';
import { BG3_CLASSES_MAX, BG3_LEVEL_MAX, BG3_PARTY_MAX, Bg3SavePayloadSchema } from './companion-bg3-save.schema.js';
import { CompanionTimestampSchema } from './companion-common.schema.js';
import { DEV_BRIDGE_PAGE_MAX_BYTES, DevBridgeNextSchema, devBridgeMaxBytes } from './companion-dev-bridge.schema.js';

// ============================================================
// Companion dev bridge v1 — BG3 save reads (ROK-2077).
// GET /dev/v1/bg3/saves                       → `bg3-saves`
// GET /dev/v1/bg3/saves/<saveRef>/structure   → `bg3-save-structure`
// What the `bg3-save` collector sees, REDACTED BY SHAPE: strict objects only,
// identifiers limited to [A-Za-z0-9_.] (no path, GUID, space or display
// name fits), and no string or key anywhere may hold a GUID. Never names,
// profile ids, GUIDs, file paths, positions, dialogue or image bytes.
// ============================================================

/** `saveRef`: the first 12 hex chars of a hash of the save — opaque, never a folder or file name. */
export const DEV_BRIDGE_BG3_SAVE_REF_RE = /^[0-9a-f]{12}$/;

/**
 * Upper bound of one `party` row, serialised. Not a separate check: the field
 * caps below already keep the worst-case row under it (the spec builds that
 * row), so a row plus the page head always fits one 16 KiB page.
 */
export const DEV_BRIDGE_BG3_PARTY_ROW_MAX_BYTES = 6_144;

/** A GUID (UUID shape, dashed or not) anywhere in a BG3 dev-bridge body is a privacy bug. */
const GUID_RE = /[0-9A-Fa-f]{8}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{4}-?[0-9A-Fa-f]{12}/;

/** A Larian engine/stats/NewAge identifier: `ARM_Hat`, `Wizard`, `game.stats.v3.StatsComponent`. */
const bg3Ident = (max: number) => z.string().regex(/^[A-Za-z0-9_.]+$/).min(1).max(max);
const Count = z.number().int().min(0);

export const DevBridgeBg3SaveRefSchema = z.string().regex(DEV_BRIDGE_BG3_SAVE_REF_RE);

/**
 * Why the collector fell back to the `SaveInfo`-only payload (null = it did not):
 * `no-newage` (Globals.lsf has no NewAge blob), `newage-unreadable` (bad LSMF),
 * `lsf-unreadable` (an LSF file failed to parse), `meta-missing` (no meta.lsf).
 * New values are additive.
 */
export const DevBridgeBg3FallbackReasonSchema = z.enum(['no-newage', 'newage-unreadable', 'lsf-unreadable', 'meta-missing']);

/** LSF format version of the two LSF files the collector reads; null = file absent or unreadable. */
const LsfVersion = z.number().int().min(1).max(255).nullable();

/** One row of GET /dev/v1/bg3/saves — one `.lsv` the collector sees. */
export const DevBridgeBg3SaveRowSchema = z
    .object({
        saveRef: DevBridgeBg3SaveRefSchema,
        /** First 8 hex chars of the `bg3-save` `campaignKey` (a SHA-256), so a row joins to its uploads. */
        campaignKeyPrefix: z.string().regex(/^[0-9a-f]{8}$/),
        campaignKeySource: Bg3SavePayloadSchema.shape.campaignKeySource,
        gameVersion: Bg3SavePayloadSchema.shape.gameVersion.nullable(),
        savedAt: CompanionTimestampSchema.nullable(),
        partySize: z.number().int().min(0).max(BG3_PARTY_MAX).nullable(),
        nonSummonCount: z.number().int().min(0).max(BG3_PARTY_MAX).nullable(),
        /** meta.lsf `ClientDatas/ClientData` count — the co-op hint; null when meta.lsf is unreadable. */
        clientCount: z.number().int().min(0).max(16).nullable(),
        lsfVersions: z.object({ meta: LsfVersion, globals: LsfVersion }).strict(),
        newAgeBytes: z.number().int().min(0).max(1_073_741_824),
        fallbackReason: DevBridgeBg3FallbackReasonSchema.nullable(),
    })
    .strict();

type Path = (string | number)[];

/** Adds a `custom` issue at every string value or object key holding a GUID. */
function checkNoGuid(value: unknown, path: Path, ctx: z.RefinementCtx): void {
    if (typeof value === 'string') {
        if (GUID_RE.test(value)) ctx.addIssue({ code: 'custom', path, message: 'A GUID is not allowed in a BG3 dev-bridge body' });
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => checkNoGuid(v, [...path, i], ctx));
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value)) {
        if (GUID_RE.test(key)) ctx.addIssue({ code: 'custom', path: [...path, key], message: 'A GUID is not allowed as a key' });
        checkNoGuid(v, [...path, key], ctx);
    }
}

const fitsPage = devBridgeMaxBytes(DEV_BRIDGE_PAGE_MAX_BYTES, 'Response body');

/** Every BG3 body: no GUID anywhere, ≤ 16 KiB serialised. */
function bg3BodyChecks(value: unknown, ctx: z.RefinementCtx): void {
    checkNoGuid(value, [], ctx);
    fitsPage(value, ctx);
}

/** GET /dev/v1/bg3/saves?cursor= */
export const DevBridgeBg3SavesSchema = z
    .object({ saves: z.array(DevBridgeBg3SaveRowSchema).max(64), next: DevBridgeNextSchema })
    .strict()
    .superRefine(bg3BodyChecks);

/** Whether the companion has a decoder for this `(type, version, elementSize)` triple. */
export const DevBridgeBg3DecoderStatusSchema = z.enum(['ok', 'unsupported', 'none']);

/** One NewAge type-table record — counts only, never element bytes. */
export const DevBridgeBg3TypeRowSchema = z
    .object({
        type: bg3Ident(128),
        version: z.number().int().min(0).max(65_535),
        elementSize: z.number().int().min(0).max(1_048_576),
        count: Count,
        decoder: DevBridgeBg3DecoderStatusSchema,
    })
    .strict();

/** What the decoders could link up — the S0 verification questions, as counts and booleans. */
export const DevBridgeBg3StructureChecksSchema = z
    .object({
        partyEntitiesFound: Count,
        partyMatchesSaveInfo: z.boolean(),
        portraitsFound: Count,
        portraitsMapped: Count,
        metaNamesMatchParty: z.boolean(),
        ownerProfileMatchesLocal: z.boolean(),
    })
    .strict();

const AbilityScore = z.number().int().min(1).max(30);

export const DevBridgeBg3AbilitiesSchema = z
    .object({ str: AbilityScore, dex: AbilityScore, con: AbilityScore, int: AbilityScore, wis: AbilityScore, cha: AbilityScore })
    .strict();

export const DevBridgeBg3ClassLevelSchema = z
    .object({ classId: bg3Ident(64), subclassId: bg3Ident(64).nullable(), level: z.number().int().min(1).max(BG3_LEVEL_MAX) })
    .strict();

/** One equipped item: the equipment slot name and the item's stats id (e.g. `ARM_Hat`). */
export const DevBridgeBg3EquipmentSchema = z.object({ slot: bg3Ident(32), statsId: bg3Ident(64) }).strict();

/** Decoded fields of one party member; each is absent when its decoder is `unsupported` or `none`. */
export const DevBridgeBg3DecodedSchema = z
    .object({
        abilities: DevBridgeBg3AbilitiesSchema.optional(),
        proficiencyBonus: z.number().int().min(1).max(10).optional(),
        maxHp: z.number().int().min(1).max(100_000).optional(),
        classLevels: z.array(DevBridgeBg3ClassLevelSchema).max(BG3_CLASSES_MAX).optional(),
        equipment: z.array(DevBridgeBg3EquipmentSchema).max(19).optional(),
    })
    .strict();

/** One party member by 0-based party index — never a name, GUID or profile id. */
export const DevBridgeBg3PartyRowSchema = z
    .object({ slot: z.number().int().min(0).max(BG3_PARTY_MAX - 1), decoded: DevBridgeBg3DecodedSchema })
    .strict();

/**
 * GET /dev/v1/bg3/saves/<saveRef>/structure?cursor= — paged by ROW: every page
 * repeats `saveRef` + `checks`; the companion fills pages with the remaining
 * `types` rows first, then `party` rows, never splitting a row (a party row is
 * < DEV_BRIDGE_BG3_PARTY_ROW_MAX_BYTES by its field caps, so one always fits). Unknown saveRef → 404 `not_found`.
 */
export const DevBridgeBg3SaveStructureSchema = z
    .object({
        saveRef: DevBridgeBg3SaveRefSchema,
        types: z.array(DevBridgeBg3TypeRowSchema).max(512),
        checks: DevBridgeBg3StructureChecksSchema,
        party: z.array(DevBridgeBg3PartyRowSchema).max(BG3_PARTY_MAX),
        next: DevBridgeNextSchema,
    })
    .strict()
    .superRefine(bg3BodyChecks);

export type DevBridgeBg3SaveRow = z.output<typeof DevBridgeBg3SaveRowSchema>;
export type DevBridgeBg3Saves = z.output<typeof DevBridgeBg3SavesSchema>;
export type DevBridgeBg3PartyRow = z.output<typeof DevBridgeBg3PartyRowSchema>;
export type DevBridgeBg3SaveStructure = z.output<typeof DevBridgeBg3SaveStructureSchema>;
