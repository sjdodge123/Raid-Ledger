import { z } from 'zod';
// Via the barrel, never by file path: ROK-1733 moves the Forever schemas
// between files under the same export names. ESM live bindings make the
// cycle safe — index.ts exports characters/blizzard before this file.
import { WowForeverRulesetSchema } from './blizzard.schema.js';
import {
    ADDON_QUEST_OBJECTIVES_MAX,
    ADDON_QUESTS_COMPLETED_MAX,
    ADDON_QUESTS_IN_PROGRESS_MAX,
} from './wow-addon-import.schema.js';

// ============================================================
// WoW: Forever addon export payload (ROK-1724)
//
// The exact envelope the RaidLedger addon (ROK-1723) emits inside an
// `!RL1!<section>!<base64(zlib(json))>` string. EVERY object is `.strict()`:
// an unknown key — an `officerNote` above all — rejects the whole string
// (operator ruling 2026-10-04, Q4). Loosen nothing here without a ruling.
// ============================================================

/** Envelope version in the `!RL<n>!` header. */
export const ADDON_EXPORT_ENVELOPE_VERSION = 1;
/** Payload `schema` number inside the JSON. */
export const ADDON_EXPORT_PAYLOAD_SCHEMA = 1;

export const AddonExportSectionSchema = z.enum(['char', 'guild', 'raid']);
export type AddonExportSection = z.infer<typeof AddonExportSectionSchema>;

/** Postgres `int4` ceiling — every id lands in an `integer` column. */
const INT4_MAX = 2_147_483_647;
/** Unix seconds; ceiling 2100-01-01 so a millisecond value is rejected. */
const UNIX_SECONDS_MAX = 4_102_444_800;

const id = z.number().int().nonnegative().max(INT4_MAX);
const count = z.number().int().nonnegative().max(INT4_MAX);
const unixSeconds = z.number().int().positive().max(UNIX_SECONDS_MAX);
const level = z.number().int().min(1).max(100);

/** In-game player GUID, e.g. `Player-1234-0ABCDEF0`. */
export const AddonGuidSchema = z.string().regex(/^Player-\d{1,5}-[0-9A-F]{8}$/);
/** Class token as the client reports it, e.g. `PALADIN`, `DEATHKNIGHT`. */
export const AddonClassTokenSchema = z.string().regex(/^[A-Z]{2,16}$/);

export const AddonFactionSchema = z.enum(['Alliance', 'Horde', 'Neutral']);

// ---------- envelope ----------

/** `client.region` is `GetCurrentRegion()`: 1 us · 2 kr · 3 eu · 4 tw · 5 cn. */
export const AddonClientSchema = z.object({
    interface: z.number().int().nonnegative().max(INT4_MAX),
    build: z.string().max(32),
    locale: z.string().max(8),
    region: z.number().int().min(1).max(5),
}).strict();
export type AddonClient = z.infer<typeof AddonClientSchema>;

const rawName = z.string().max(100).nullable();

/**
 * Raw identity calls, stored as returned — the server decides the name.
 * Lua drops a trailing nil, so the second tuple element may be absent.
 */
export const AddonWhoRawSchema = z.object({
    getUnitName: z.string().max(100).optional(),
    unitName: z.tuple([rawName, rawName.optional()]).optional(),
    unitFullName: z.tuple([rawName, rawName.optional()]).optional(),
    realmName: z.string().max(100).optional(),
}).strict();

export const AddonWhoSchema = z.object({
    guid: AddonGuidSchema,
    fullName: z.string().max(100),
    raw: AddonWhoRawSchema,
    /** `normal|pvp|roleplaying|hardcore`; null when the addon can't tell. */
    ruleset: WowForeverRulesetSchema.nullable(),
    class: AddonClassTokenSchema,
    race: z.string().max(32),
    /** `UnitSex`: 2 → male, 3 → female; 1 (unknown) → omit (ROK-1742). */
    gender: z.enum(['male', 'female']).optional(),
    level,
    faction: AddonFactionSchema,
    /** Exporter's guild, if any — the raid-pull dedupe key (Q5). */
    guildName: z.string().max(64).optional(),
}).strict();
export type AddonWho = z.infer<typeof AddonWhoSchema>;

const envelope = {
    schema: z.literal(ADDON_EXPORT_PAYLOAD_SCHEMA),
    addonVersion: z.string().max(32),
    client: AddonClientSchema,
    exportedAt: unixSeconds,
    who: AddonWhoSchema,
};

// ---------- char ----------

export const AddonGearItemSchema = z.object({
    slot: z.number().int().min(1).max(19),
    itemId: id.optional(),
    /** Raw `|Hitem:…|h` link; parsed to itemId + bonusIds, then dropped. */
    link: z.string().max(512).optional(),
    ilvl: count.optional(),
}).strict();

/**
 * One talent node. ROK-1742 adds the display + layout keys, all optional.
 * Forever has ONE `C_Traits` tree per class, laid out as vanilla: 3 sub-trees
 * side by side × 4 columns (12 distinct posX) and 7+ tiers (distinct posY).
 * The addon derives `col12` = index of posX among the class tree's distinct
 * posX values, `tree = floor(col12 / 4)`, `col = col12 % 4`, and `row` = index
 * of posY among the distinct posY values (0 = top). That pixel → index
 * mapping is UNVERIFIED beyond Warrior (12 × 7), so the raw `posX`/`posY` are
 * always sent too and are authoritative; `tree`/`row`/`col` are hints.
 */
export const AddonTalentNodeSchema = z.object({
    nodeId: id,
    rank: count,
    entryId: id.optional(),
    /** `C_Spell.GetSpellName(spellId)`. */
    name: z.string().max(64).optional(),
    /** entry → definitionID → spellID. */
    spellId: z.number().int().positive().max(INT4_MAX).optional(),
    maxRanks: z.number().int().min(1).max(255).optional(),
    /** Sub-tree 0–2, derived from posX (see above). */
    tree: z.number().int().min(0).max(2).optional(),
    /** Tier 0–9 (0 = top), derived from posY. */
    row: z.number().int().min(0).max(9).optional(),
    /** Column 0–3 within the sub-tree, derived from posX. */
    col: z.number().int().min(0).max(3).optional(),
    /** Raw `C_Traits` node position, stored verbatim. */
    posX: count.optional(),
    posY: count.optional(),
}).strict();
export type AddonTalentNode = z.infer<typeof AddonTalentNodeSchema>;

export const AddonTalentsSchema = z.object({
    configId: id.optional(),
    importString: z.string().max(2048).optional(),
    nodes: z.array(AddonTalentNodeSchema).max(200),
}).strict();

export const AddonLockoutSchema = z.object({
    name: z.string().max(128),
    instanceId: id,
    difficultyId: id,
    resetAt: unixSeconds,
    killed: count,
    total: count,
}).strict();
export type AddonLockout = z.infer<typeof AddonLockoutSchema>;

/** One quest-log objective; `have`/`need` from `numFulfilled`/`numRequired`. */
export const AddonQuestObjectiveSchema = z.object({
    text: z.string().max(128),
    done: z.boolean(),
    have: count.optional(),
    need: count.optional(),
}).strict();
export type AddonQuestObjective = z.infer<typeof AddonQuestObjectiveSchema>;

export const AddonQuestInProgressSchema = z.object({
    questId: id,
    title: z.string().max(128).optional(),
    objectives: z.array(AddonQuestObjectiveSchema).max(ADDON_QUEST_OBJECTIVES_MAX).optional(),
}).strict();
export type AddonQuestInProgress = z.infer<typeof AddonQuestInProgressSchema>;

/** ROK-1742. Optional as a whole; when present both arrays are required. */
export const AddonQuestsSchema = z.object({
    completed: z.array(id).max(ADDON_QUESTS_COMPLETED_MAX),
    inProgress: z.array(AddonQuestInProgressSchema).max(ADDON_QUESTS_IN_PROGRESS_MAX),
}).strict();
export type AddonQuests = z.infer<typeof AddonQuestsSchema>;

export const AddonCharDataSchema = z.object({
    gear: z.array(AddonGearItemSchema).max(19),
    talents: AddonTalentsSchema,
    lockouts: z.array(AddonLockoutSchema).max(100),
    quests: AddonQuestsSchema.optional(),
}).strict();
export type AddonCharData = z.infer<typeof AddonCharDataSchema>;

// ---------- guild ----------

/** No `officerNote` key exists: `.strict()` turns one into a reject (Q4). */
export const AddonGuildMemberSchema = z.object({
    guid: AddonGuidSchema,
    name: z.string().max(100),
    rankIndex: z.number().int().min(0).max(255),
    rank: z.string().max(64),
    level,
    class: AddonClassTokenSchema,
    online: z.boolean(),
    lastOnlineDays: count.optional(),
    /** Public note — present only when the player opted in, addon-side. */
    note: z.string().max(256).optional(),
}).strict();
export type AddonGuildMember = z.infer<typeof AddonGuildMemberSchema>;

export const AddonGuildDataSchema = z.object({
    name: z.string().min(1).max(64),
    rawRealm: z.string().max(64).optional(),
    snapshotAt: unixSeconds,
    canViewOfficerNote: z.literal(false),
    members: z.array(AddonGuildMemberSchema).max(2000),
}).strict();
export type AddonGuildData = z.infer<typeof AddonGuildDataSchema>;

// ---------- raid ----------

export const AddonPullSchema = z.object({
    encounterId: id,
    name: z.string().max(128),
    difficultyId: id,
    groupSize: z.number().int().min(1).max(40),
    instanceId: id.optional(),
    startAt: unixSeconds,
    endAt: unixSeconds,
    success: z.boolean(),
    roster: z.array(AddonGuidSchema).max(40),
    rosterNames: z.array(z.string().max(100)).max(40),
}).strict();
export type AddonPull = z.infer<typeof AddonPullSchema>;

export const AddonRaidDataSchema = z.object({
    pulls: z.array(AddonPullSchema).max(200),
}).strict();
export type AddonRaidData = z.infer<typeof AddonRaidDataSchema>;

// ---------- the payload ----------

export const AddonCharExportSchema = z.object({
    ...envelope, section: z.literal('char'), data: AddonCharDataSchema,
}).strict();
export const AddonGuildExportSchema = z.object({
    ...envelope, section: z.literal('guild'), data: AddonGuildDataSchema,
}).strict();
export const AddonRaidExportSchema = z.object({
    ...envelope, section: z.literal('raid'), data: AddonRaidDataSchema,
}).strict();

export const AddonExportSchema = z.discriminatedUnion('section', [
    AddonCharExportSchema,
    AddonGuildExportSchema,
    AddonRaidExportSchema,
]);
export type AddonExport = z.infer<typeof AddonExportSchema>;
export type AddonCharExport = z.infer<typeof AddonCharExportSchema>;
export type AddonGuildExport = z.infer<typeof AddonGuildExportSchema>;
export type AddonRaidExport = z.infer<typeof AddonRaidExportSchema>;

// ============================================================
// FROZEN: `character_addon_snapshots.data` (section 'char').
// ROK-1727 reads this shape. The import sanitises display strings and
// replaces each gear `link` with its parsed `bonusIds`; the link itself is
// never stored. Changing this shape needs a new `schema` number.
// Schema 2 (ROK-1742) = schema 1 + optional `quests`, talent node
// name/spell/position keys, gear `enchantId?/gemIds?`; schema-1 rows parse
// unchanged.
// ============================================================

/** `character_addon_snapshots.schema` written for every new `char` row. */
export const ADDON_CHAR_SNAPSHOT_SCHEMA = 2;
/** Snapshot schema numbers a reader must accept. */
export const AddonCharSnapshotSchemaNumberSchema = z.union([z.literal(1), z.literal(2)]);

export const AddonSnapshotGearItemSchema = z.object({
    slot: z.number().int().min(1).max(19),
    itemId: id.optional(),
    ilvl: count.optional(),
    /** Parsed from the item link; empty when there was no link. */
    bonusIds: z.array(z.number().int()).max(32),
    /** Schema 2: link field 1, omitted when 0/absent. */
    enchantId: id.optional(),
    /** Schema 2: link fields 2-5, non-empty ids only; omitted when none. */
    gemIds: z.array(id).max(4).optional(),
}).strict();
export type AddonSnapshotGearItem = z.infer<typeof AddonSnapshotGearItemSchema>;

export const AddonCharSnapshotDataSchema = z.object({
    gear: z.array(AddonSnapshotGearItemSchema).max(19),
    talents: AddonTalentsSchema,
    lockouts: z.array(AddonLockoutSchema).max(100),
    quests: AddonQuestsSchema.optional(),
}).strict();
export type AddonCharSnapshotData = z.infer<typeof AddonCharSnapshotDataSchema>;
