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
// Each body cap is >= the LARGEST schema-valid message of its kind (every
// array full, every string at max length, free text of control characters
// that JSON escapes to 6 bytes), so the array caps always bind first.

/** Request-body cap for a `character` message (UTF-8 JSON); worst case ≈ 1.9 MB. */
export const VALHEIM_LINK_CHARACTER_MAX_BYTES = 2_097_152;
/** Request-body cap for a `map` message (inline bitmaps); worst case ≈ 7.0 MB. */
export const VALHEIM_LINK_MAP_MAX_BYTES = 8_388_608;
/** Request-body cap for an `items` message; worst case ≈ 9.4 MB. */
export const VALHEIM_LINK_ITEMS_MAX_BYTES = 10_485_760;
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

// Spelled as arithmetic, not literals: the ROK-1471 guard spec forbids any
// 15+ digit literal in packages/contract/src (Discord permission integers).
const TWO = BigInt(2);
const INT64_LIMIT = TWO ** BigInt(63);
/** Signed 64-bit range (a .NET `long`, a Postgres `bigint`): -2^63 .. 2^63-1. */
export const VALHEIM_LINK_INT64_MIN = (-INT64_LIMIT).toString(); // -9223372036854775808
export const VALHEIM_LINK_INT64_MAX = (INT64_LIMIT - BigInt(1)).toString(); // 9223372036854775807
/**
 * First individual-account SteamID64 (universe 1, type 1, instance 1,
 * account 0) = 0x0110000100000000 = 2^56 + 2^52 + 2^32 = 76561197960265728.
 */
export const VALHEIM_LINK_STEAMID64_MIN = (
    TWO ** BigInt(56) + TWO ** BigInt(52) + TWO ** BigInt(32)
).toString();

/**
 * True when `v` matches `canonical` (a length-bounded decimal pattern) AND
 * lies in [min, max]. Re-tests the pattern itself: in Zod 4 a failed
 * `.regex()` does not stop later checks unless it aborts, so this must
 * never reach `BigInt` with a non-decimal or unbounded string (`BigInt('abc')`
 * throws out of `safeParse`).
 */
const inBigIntRange = (v: string, canonical: RegExp, min: string, max: string): boolean => {
    if (v.length > 20 || !canonical.test(v)) return false;
    const n = BigInt(v);
    return n >= BigInt(min) && n <= BigInt(max);
};

const STEAMID64_PATTERN = /^[1-9]\d{16}$/;
const INT64_PATTERN = /^(0|-?[1-9]\d{0,18})$/;

/**
 * SteamID64 as a decimal STRING — it exceeds `Number.MAX_SAFE_INTEGER`, so
 * a JSON number would lose precision. 17 digits, at or above the
 * individual-account base (no fixed `7656119` prefix: account ids past
 * ~2.04 B roll it over to `7656120…`).
 */
export const ValheimSteamId64Schema = z
    .string()
    .regex(STEAMID64_PATTERN, { abort: true })
    .refine((v) => inBigIntRange(v, STEAMID64_PATTERN, VALHEIM_LINK_STEAMID64_MIN, VALHEIM_LINK_INT64_MAX), {
        message: `SteamID64 must be >= ${VALHEIM_LINK_STEAMID64_MIN}`,
    });

/**
 * A .NET `long` (Valheim `playerId`, world `uid`) as a CANONICAL decimal
 * string: no leading zeros, no `-0`, inside the signed 64-bit range — so
 * one id has exactly one spelling and always fits a `bigint` column.
 */
export const ValheimInt64StringSchema = z
    .string()
    .regex(INT64_PATTERN, { abort: true })
    .refine((v) => inBigIntRange(v, INT64_PATTERN, VALHEIM_LINK_INT64_MIN, VALHEIM_LINK_INT64_MAX), {
        message: 'outside the signed 64-bit range',
    });

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

/**
 * The mod's own version: SemVer 2.0.0 (`1.0.0`, `1.2.0-beta.1`, `1.0.0+build.1`),
 * at most 64 chars. Both checks abort so the regex never runs on an oversized
 * string and nothing later sees a rejected value.
 */
const SEMVER_PATTERN =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const ValheimModVersionSchema = z
    .string()
    .max(64, { abort: true })
    .regex(SEMVER_PATTERN, { abort: true });

/** Longest `capturedAt`: `YYYY-MM-DDTHH:MM:SS.sssZ` (≤ 3 fractional digits). */
export const VALHEIM_LINK_TIMESTAMP_MAX_CHARS = 24;
/**
 * How far past the server clock a `capturedAt` may be (CONTRACT.md §1). Not
 * checkable in Zod (no clock); the ingest endpoint rejects anything later,
 * so a skewed clock cannot pin a snapshot as "latest" forever.
 */
export const VALHEIM_LINK_CAPTURED_AT_MAX_FUTURE_MS = 300_000;

/**
 * ISO-8601 UTC instant with a `Z` offset, e.g. `2026-10-17T20:15:00Z`; at
 * most millisecond precision (the length cap enforces it).
 */
export const ValheimTimestampSchema = z.iso.datetime().max(VALHEIM_LINK_TIMESTAMP_MAX_CHARS);

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
