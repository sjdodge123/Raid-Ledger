import { z } from 'zod';
import {
    VALHEIM_LINK_BITMAP_DATA_MAX_CHARS,
    VALHEIM_LINK_BITMAP_EDGE_MAX,
    VALHEIM_LINK_PINS_MAX,
    ValheimBinaryRefSchema,
    ValheimInt64StringSchema,
    ValheimSteamId64Schema,
    valheimLinkHeaderShape,
} from './valheim-link-common.schema.js';

// ============================================================
// RL Valheim Link — `kind: "map"` (ROK-1829)
// One message per character per world: explored fog, pins, and a
// reference to the world's base-map PNG. CONTRACT.md §4.
// ============================================================

/** Largest |x| / |z| accepted, metres (vanilla world radius is 10 500). */
export const VALHEIM_LINK_WORLD_COORD_MAX = 32_768;

/**
 * Minimap grid the bitmaps and pins are drawn on. UNVERIFIED constants
 * (from `Minimap`): vanilla `textureSize` 2048, `pixelSize` 12 m, world
 * origin at the texture centre. The mod sends them so Raid Ledger never
 * hardcodes them.
 */
export const ValheimMapGridSchema = z.object({
    textureSize: z.number().int().min(64).max(VALHEIM_LINK_BITMAP_EDGE_MAX),
    pixelSizeMetres: z.number().positive().max(256),
}).strict();
export type ValheimMapGrid = z.infer<typeof ValheimMapGridSchema>;

/** Raw bitset bytes for a `width × height` mask: `⌈width·height/8⌉`. */
export function valheimLinkBitmapBytes(width: number, height: number): number {
    return Math.ceil((width * height) / 8);
}

/**
 * Largest gzip member accepted for a `width × height` mask: the raw bytes
 * plus zlib's conservative deflate bound (`n/8 + n/64`) plus header/trailer
 * slack. Anything bigger cannot be an honest compression of the bitset.
 */
export function valheimLinkBitmapMaxGzipBytes(width: number, height: number): number {
    const raw = valheimLinkBitmapBytes(width, height);
    return raw + Math.ceil(raw / 8) + Math.ceil(raw / 64) + 64;
}

/** Shortest possible gzip member (empty deflate stream) as base64: 20 B → 28 chars. */
export const VALHEIM_LINK_BITMAP_DATA_MIN_CHARS = 28;

/**
 * Explored mask as a packed bitset: pixel (px, py) is bit `py * width + px`,
 * byte `i >> 3`, bit `i & 7` (LSB first); 1 = explored. `py = 0` is the
 * south edge (`py = z / pixelSize + textureSize / 2`). The bytes are ONE
 * gzip member (magic `1f 8b 08` → base64 prefix `H4sI`), then standard
 * base64 (RFC 4648 §4, padded). The base64 check is a single character
 * class plus a length refine — a repeated-group regex overflows V8's regex
 * stack on multi-MB input and throws through `safeParse`. Zod cannot (and,
 * to stay sync and browser-safe, does not) inflate: the SERVER gunzips with
 * `maxOutputLength = valheimLinkBitmapBytes(width, height)` and rejects any
 * other length (CONTRACT.md §6).
 */
export const ValheimExploredBitmapSchema = z.object({
    encoding: z.literal('gzip+base64-bitset-lsb0'),
    width: z.number().int().min(64).max(VALHEIM_LINK_BITMAP_EDGE_MAX),
    height: z.number().int().min(64).max(VALHEIM_LINK_BITMAP_EDGE_MAX),
    data: z
        .string()
        .min(VALHEIM_LINK_BITMAP_DATA_MIN_CHARS)
        .max(VALHEIM_LINK_BITMAP_DATA_MAX_CHARS)
        .regex(/^H4sI[A-Za-z0-9+/]*={0,2}$/),
}).strict().superRefine((bmp, ctx) => {
    if (bmp.data.length % 4 !== 0) {
        ctx.addIssue({ code: 'custom', path: ['data'], message: 'base64 length must be a multiple of 4' });
    }
    const maxChars = 4 * Math.ceil(valheimLinkBitmapMaxGzipBytes(bmp.width, bmp.height) / 3);
    if (bmp.data.length > maxChars) {
        ctx.addIssue({ code: 'custom', path: ['data'], message: `compressed bitmap exceeds ${maxChars} chars for ${bmp.width}×${bmp.height}` });
    }
});
export type ValheimExploredBitmap = z.infer<typeof ValheimExploredBitmapSchema>;

/**
 * Pin type as `Minimap.PinType.ToString()` — `Icon0`…`Icon4`, `Death`,
 * `Bed`, `Shout`, `Boss`, `Hildir1`… Open set: modded types render with a
 * generic icon.
 */
export const ValheimPinTypeSchema = z.string().regex(/^[A-Za-z0-9_]{1,32}$/);

/** A world coordinate in metres, |v| ≤ `VALHEIM_LINK_WORLD_COORD_MAX` (shared with `containers`, ROK-1853). */
export const ValheimWorldCoordSchema = z.number().min(-VALHEIM_LINK_WORLD_COORD_MAX).max(VALHEIM_LINK_WORLD_COORD_MAX);
const worldCoord = ValheimWorldCoordSchema;

export const ValheimMapPinSchema = z.object({
    type: ValheimPinTypeSchema,
    /** Player-typed free text — never log it. Empty for unnamed pins. */
    label: z.string().max(64),
    /** World position in metres; east-west. */
    x: worldCoord,
    /** World position in metres; north-south. */
    z: worldCoord,
    /** The red cross the player toggles on a pin. */
    checked: z.boolean(),
    /** True when the pin came from a cartography table (another author). */
    shared: z.boolean(),
}).strict();
export type ValheimMapPin = z.infer<typeof ValheimMapPinSchema>;

export const ValheimMapCharacterRefSchema = z.object({
    steamId: ValheimSteamId64Schema,
    playerId: ValheimInt64StringSchema,
    worldUid: ValheimInt64StringSchema,
}).strict();

export const ValheimMapMessageSchema = z.object({
    ...valheimLinkHeaderShape,
    kind: z.literal('map'),
    character: ValheimMapCharacterRefSchema,
    grid: ValheimMapGridSchema,
    /** The player's own exploration. */
    explored: ValheimExploredBitmapSchema,
    /**
     * The shared cartography-table layer, or null when the mod did not
     * include it. The web shows personal fog by default and this layer as
     * a toggle (operator ruling).
     */
    sharedExplored: ValheimExploredBitmapSchema.nullable(),
    pins: z.array(ValheimMapPinSchema).max(VALHEIM_LINK_PINS_MAX),
    /**
     * The world's base-map PNG (rendered once per world uid + game version
     * by the server half of the mod), or null when not rendered yet.
     */
    baseMap: ValheimBinaryRefSchema.nullable(),
}).strict().superRefine((msg, ctx) => {
    const size = msg.grid.textureSize;
    const squares = [
        ['explored', msg.explored, 'bitmap'],
        ['sharedExplored', msg.sharedExplored, 'bitmap'],
        // The server also checks the uploaded PNG's IHDR against this (§4).
        ['baseMap', msg.baseMap, 'base map'],
    ] as const;
    for (const [name, ref, what] of squares) {
        if (ref && (ref.width !== size || ref.height !== size)) {
            ctx.addIssue({ code: 'custom', path: [name], message: `${what} size must equal grid.textureSize` });
        }
    }
});
export type ValheimMapMessage = z.infer<typeof ValheimMapMessageSchema>;
