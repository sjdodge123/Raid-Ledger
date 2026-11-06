import { z } from 'zod';
import { BG3_CLASSES_MAX, BG3_LEVEL_MAX, BG3_PARTY_MAX, Bg3SavePayloadSchema } from './companion-bg3-save.schema.js';
import { CompanionTimestampSchema } from './companion-common.schema.js';
import { checkBg3Redaction, checkUniqueBy } from './companion-dev-bridge-bg3-redaction.js';
import { DEV_BRIDGE_PAGE_MAX_BYTES, devBridgeMaxBytes } from './companion-dev-bridge.schema.js';

// ============================================================
// Companion dev bridge v1 — BG3 save reads (ROK-2077).
// GET /dev/v1/bg3/saves                       → `bg3-saves`
// GET /dev/v1/bg3/saves/<saveRef>/structure   → `bg3-save-structure`
// What the `bg3-save` collector sees, REDACTED BY SHAPE: strict objects only,
// closed enums / prefixed or dotted id patterns where the game has them, and
// no string or key anywhere may hold a GUID or a 10+ digit run
// (companion-dev-bridge-bg3-redaction.ts). Never names, profile ids, GUIDs,
// file paths, positions, dialogue or image bytes.
// ============================================================

/** `saveRef`: first 12 hex chars of HMAC-SHA256(per-install secret, save-relative path) — opaque, never a name. */
export const DEV_BRIDGE_BG3_SAVE_REF_RE = /^[0-9a-f]{12}$/;

/**
 * Upper bound of one `party` row, serialised — checked on every row. The field
 * caps below already keep the worst-case row under it (the spec builds that
 * row), so a row plus the page head always fits one 16 KiB page.
 */
export const DEV_BRIDGE_BG3_PARTY_ROW_MAX_BYTES = 6_144;

/** Rejects a string that is all hex and ≥ 8 chars — a GUID fragment (`6f2b8c1e`), not an id. */
const NOT_LONG_HEX = '(?![0-9A-Fa-f]{8,}$)';

/**
 * A Larian class/subclass id (`Wizard`, `EvocationSchool`). A one-word name fits; the companion only emits game data.
 * An unmapped class (a mod class known only by UUID) is omitted from `classLevels`, never sent as a UUID fragment.
 */
export const devBridgeBg3Ident = (max: number) => z.string().regex(new RegExp(`^${NOT_LONG_HEX}[A-Za-z0-9_.]+$`)).min(1).max(max);
const Count = z.number().int().min(0).max(100_000_000);

/**
 * Cursor of both BG3 bodies: `p<page>_<section>_<row offset>`, e.g. `p2_types_9`.
 * A closed grammar, so no file or folder name fits (the shared
 * `DevBridgeCursorSchema` is a free 128-char token and is left unchanged).
 */
export const DevBridgeBg3CursorSchema = z.string().regex(/^p[1-9][0-9]{0,3}_(saves|types|party)_[0-9]{1,6}$/);
export const DevBridgeBg3NextSchema = DevBridgeBg3CursorSchema.nullable();

/**
 * NewAge type-table name: a component record — lowercase namespace + ≥2 dotted segments
 * (`core.v0.Level`, `game.stats.v3.StatsComponent`) — or a bare enum (`EAbility`, `EResistanceType`).
 */
export const DevBridgeBg3TypeNameSchema = z
    .string()
    .regex(new RegExp(`^${NOT_LONG_HEX}(?:[a-z][a-z0-9_]*(\\.[A-Za-z0-9_]+){2,}|E[A-Z][A-Za-z0-9]{1,80})$`))
    .max(128);

/** Item stats id: an uppercase Larian prefix, `_`, the rest (`ARM_Hat`, `WPN_Longsword_1`, `FOR_UnfortunateGnome`). */
export const DevBridgeBg3StatsIdSchema = z.string().regex(/^[A-Z][A-Z0-9]{1,5}_[A-Za-z0-9_]{1,57}$/).max(64);

/** BG3 `ItemSlot` names, slot table 0–18. Adding a slot is breaking — a v1 validator rejects it (see CONTRACT.md). */
export const BG3_EQUIPMENT_SLOTS = [
    'Helmet', 'Breast', 'Cloak', 'MeleeMainHand', 'MeleeOffHand', 'RangedMainHand', 'RangedOffHand', 'Ring', 'Underwear', 'Boots',
    'Gloves', 'Amulet', 'Ring2', 'Wings', 'Horns', 'Overhead', 'MusicalInstrument', 'VanityBody', 'VanityBoots',
] as const;
export const DevBridgeBg3EquipmentSlotSchema = z.enum(BG3_EQUIPMENT_SLOTS);

export const DevBridgeBg3SaveRefSchema = z.string().regex(DEV_BRIDGE_BG3_SAVE_REF_RE);

/** First 8 lowercase hex chars of a SHA-256 key (`campaignKey`, `characterKey`) — joins a row to its uploads, never the full key. */
export const DevBridgeBg3KeyPrefixSchema = z.string().regex(/^[0-9a-f]{8}$/);

/**
 * Why the collector fell back to the `SaveInfo`-only payload (null = it did not):
 * `no-newage` (Globals.lsf has no NewAge blob), `newage-unreadable` (bad LSMF),
 * `lsf-unreadable` (an LSF file failed to parse), `meta-missing` (no meta.lsf).
 * A closed enum: a new value is breaking (new `vN/`).
 */
export const DevBridgeBg3FallbackReasonSchema = z.enum(['no-newage', 'newage-unreadable', 'lsf-unreadable', 'meta-missing']);

/** LSF format version of the two LSF files the collector reads; null = file absent or unreadable. */
const LsfVersion = z.number().int().min(1).max(255).nullable();

/** One row of GET /dev/v1/bg3/saves — one `.lsv` the collector sees. */
export const DevBridgeBg3SaveRowSchema = z
    .object({
        saveRef: DevBridgeBg3SaveRefSchema,
        /** First 8 hex chars of the `bg3-save` `campaignKey` (a SHA-256), so a row joins to its uploads. */
        campaignKeyPrefix: DevBridgeBg3KeyPrefixSchema,
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

const fitsPage = devBridgeMaxBytes(DEV_BRIDGE_PAGE_MAX_BYTES, 'Response body');

/** Every BG3 body: no GUID or 10+ digit run in any string or key, ≤ 16 KiB serialised. */
export function devBridgeBg3BodyChecks(value: unknown, ctx: z.RefinementCtx): void {
    checkBg3Redaction(value, [], ctx);
    fitsPage(value, ctx);
}

/** GET /dev/v1/bg3/saves?cursor= */
export const DevBridgeBg3SavesSchema = z
    .object({ saves: z.array(DevBridgeBg3SaveRowSchema).max(64), next: DevBridgeBg3NextSchema })
    .strict()
    .superRefine((body, ctx) => {
        checkUniqueBy(body.saves, 'saves', 'saveRef', (r) => r.saveRef, ctx);
        devBridgeBg3BodyChecks(body, ctx);
    });

/** Whether the companion has a decoder for this `(type, version, elementSize)` triple. Closed: a new value is breaking. */
export const DevBridgeBg3DecoderStatusSchema = z.enum(['ok', 'unsupported', 'none']);

/** One NewAge type-table record — counts only, never element bytes. */
export const DevBridgeBg3TypeRowSchema = z
    .object({
        type: DevBridgeBg3TypeNameSchema,
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
    .object({ classId: devBridgeBg3Ident(64), subclassId: devBridgeBg3Ident(64).nullable(), level: z.number().int().min(1).max(BG3_LEVEL_MAX) })
    .strict();

/**
 * One equipped item: the equipment slot name and the item's stats id (e.g. `ARM_Hat`).
 * `statsId` is null when the item's stats id does not fit the pattern (a modded item) — never rewritten to fit.
 */
export const DevBridgeBg3EquipmentSchema = z
    .object({ slot: DevBridgeBg3EquipmentSlotSchema, statsId: DevBridgeBg3StatsIdSchema.nullable() })
    .strict();

/** Decoded fields of one party member; each is absent when its decoder is `unsupported` or `none`. */
export const DevBridgeBg3DecodedSchema = z
    .object({
        abilities: DevBridgeBg3AbilitiesSchema.optional(),
        proficiencyBonus: z.number().int().min(1).max(10).optional(),
        maxHp: z.number().int().min(1).max(100_000).optional(),
        classLevels: z.array(DevBridgeBg3ClassLevelSchema).max(BG3_CLASSES_MAX).optional(),
        equipment: z.array(DevBridgeBg3EquipmentSchema).max(BG3_EQUIPMENT_SLOTS.length).optional(),
    })
    .strict()
    .superRefine((d, ctx) => checkUniqueBy(d.equipment ?? [], 'equipment', 'slot', (e) => e.slot, ctx));

/**
 * One party member by 0-based party index — never a name, GUID or profile id.
 * `characterKeyPrefix` (optional, ROK-2079 OQ-4): first 8 hex of the member's
 * `characterKey = SHA-256(campaignKey ‖ ':' ‖ entityGuid)`, entityGuid as
 * lowercase hyphenated text — so a sweep can compare one entity across saves.
 * Absent when the collector cannot derive it; the GUID itself is never sent.
 */
export const DevBridgeBg3PartyRowSchema = z
    .object({
        slot: z.number().int().min(0).max(BG3_PARTY_MAX - 1),
        characterKeyPrefix: DevBridgeBg3KeyPrefixSchema.optional(),
        decoded: DevBridgeBg3DecodedSchema,
    })
    .strict()
    .superRefine(devBridgeMaxBytes(DEV_BRIDGE_BG3_PARTY_ROW_MAX_BYTES, 'Party row'));

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
        next: DevBridgeBg3NextSchema,
    })
    .strict()
    .superRefine((body, ctx) => {
        checkUniqueBy(body.party, 'party', 'slot', (r) => r.slot, ctx);
        devBridgeBg3BodyChecks(body, ctx);
    });

export type DevBridgeBg3SaveRow = z.output<typeof DevBridgeBg3SaveRowSchema>;
export type DevBridgeBg3Saves = z.output<typeof DevBridgeBg3SavesSchema>;
export type DevBridgeBg3PartyRow = z.output<typeof DevBridgeBg3PartyRowSchema>;
export type DevBridgeBg3SaveStructure = z.output<typeof DevBridgeBg3SaveStructureSchema>;
