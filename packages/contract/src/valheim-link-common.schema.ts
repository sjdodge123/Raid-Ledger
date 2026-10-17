import { z } from 'zod';

// ============================================================
// RL Valheim Link wire contract — shared primitives (ROK-1829)
//
// The BepInEx mod "RL Valheim Link" (github.com/Raid-Ledger-Plugins/
// rl-valheim-link) PUSHES these messages to a Raid Ledger ingest endpoint
// with a per-server token; Raid Ledger never reads server files (operator
// ruling). Raid Ledger owns the format exactly like LedgerLink:
// `packages/contract/valheim-link/v1/CONTRACT.md`. EVERY object is
// `.strict()` — an unknown key rejects the message. Loosen nothing here
// without a ruling.
// ============================================================

/** `schemaVersion` every v1 message carries. */
export const VALHEIM_LINK_SCHEMA_VERSION = 1;

// ---------- size caps (CONTRACT.md §7; the ingest endpoint, ROK-1833) ----------

/** Recommended request-body cap for a `character` message (UTF-8 JSON). */
export const VALHEIM_LINK_CHARACTER_MAX_BYTES = 524_288;
/** Recommended request-body cap for a `map` message (inline bitmaps). */
export const VALHEIM_LINK_MAP_MAX_BYTES = 8_388_608;
/** Recommended request-body cap for an `items` message. */
export const VALHEIM_LINK_ITEMS_MAX_BYTES = 4_194_304;
/** Recommended cap for one binary upload (base-map PNG or icon atlas). */
export const VALHEIM_LINK_BINARY_MAX_BYTES = 16_777_216;

/** Base64 characters allowed in one inline explored bitmap. */
export const VALHEIM_LINK_BITMAP_DATA_MAX_CHARS = 3_000_000;
/** Largest explored-bitmap edge, in pixels (vanilla 2048; map mods 4096). */
export const VALHEIM_LINK_BITMAP_EDGE_MAX = 4096;

export const VALHEIM_LINK_EQUIPMENT_MAX = 32;
export const VALHEIM_LINK_INVENTORY_ITEMS_MAX = 512;
export const VALHEIM_LINK_GRID_EDGE_MAX = 32;
export const VALHEIM_LINK_SKILLS_MAX = 128;
export const VALHEIM_LINK_TROPHIES_MAX = 1024;
export const VALHEIM_LINK_KNOWN_MAX = 8192;
export const VALHEIM_LINK_PINS_MAX = 2000;
export const VALHEIM_LINK_ITEM_EXPORT_MAX = 10_000;

// ---------- primitives ----------

/**
 * SteamID64 as a decimal STRING — it exceeds `Number.MAX_SAFE_INTEGER`, so
 * a JSON number would lose precision. Individual-account universe prefix.
 */
export const ValheimSteamId64Schema = z.string().regex(/^7656119\d{10}$/);

/** A .NET `long` (Valheim `playerId`, world `uid`) as a decimal string. */
export const ValheimInt64StringSchema = z.string().regex(/^-?\d{1,19}$/);

/**
 * Prefab id exactly as the game names it (`SwordIron`, `TrophyEikthyr`,
 * `$item_…` never — that is a localisation token, not a prefab).
 * Modded prefabs may use `.` or `-`.
 */
export const ValheimPrefabIdSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,96}$/);

/**
 * Raid Ledger's id for the game server, issued with the per-server token.
 * The ingest endpoint rejects a message whose `serverId` is not the
 * token's server.
 */
export const ValheimServerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** Game build as `Version.GetVersionString()` prints it, e.g. `0.220.5`. */
export const ValheimGameVersionSchema = z.string().regex(/^\d{1,4}(\.\d{1,5}){1,3}$/);

/** The mod's own SemVer, e.g. `1.0.0` or `1.2.0-beta.1`. */
export const ValheimModVersionSchema = z
    .string()
    .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,32})?$/);

/** ISO-8601 UTC instant with a `Z` offset, e.g. `2026-10-17T20:15:00Z`. */
export const ValheimTimestampSchema = z.iso.datetime();

/** Lowercase hex SHA-256 of a separately uploaded binary. */
export const ValheimSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/** Reference to a binary the mod uploads separately (CONTRACT.md §6). */
export const ValheimBinaryRefSchema = z.object({
    sha256: ValheimSha256Schema,
    byteLength: z.number().int().positive().max(VALHEIM_LINK_BINARY_MAX_BYTES),
    contentType: z.literal('image/png'),
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
}).strict();
export type ValheimBinaryRef = z.infer<typeof ValheimBinaryRefSchema>;

/**
 * Fields every message carries, spread into each message object so the
 * discriminated union stays a plain list of strict objects.
 */
export const valheimLinkHeaderShape = {
    schemaVersion: z.literal(VALHEIM_LINK_SCHEMA_VERSION),
    serverId: ValheimServerIdSchema,
    capturedAt: ValheimTimestampSchema,
    gameVersion: ValheimGameVersionSchema,
    modVersion: ValheimModVersionSchema,
} as const;
