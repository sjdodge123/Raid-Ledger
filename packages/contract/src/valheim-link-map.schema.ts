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

/**
 * Explored mask as a packed bitset: pixel (px, py) is bit `py * width + px`,
 * byte `i >> 3`, bit `i & 7` (LSB first); 1 = explored. `py = 0` is the
 * south edge (`py = z / pixelSize + textureSize / 2`). The bytes are gzip
 * compressed, then standard base64 (RFC 4648 §4, padded).
 */
export const ValheimExploredBitmapSchema = z.object({
    encoding: z.literal('gzip+base64-bitset-lsb0'),
    width: z.number().int().min(64).max(VALHEIM_LINK_BITMAP_EDGE_MAX),
    height: z.number().int().min(64).max(VALHEIM_LINK_BITMAP_EDGE_MAX),
    data: z
        .string()
        .max(VALHEIM_LINK_BITMAP_DATA_MAX_CHARS)
        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();
export type ValheimExploredBitmap = z.infer<typeof ValheimExploredBitmapSchema>;

/**
 * Pin type as `Minimap.PinType.ToString()` — `Icon0`…`Icon4`, `Death`,
 * `Bed`, `Shout`, `Boss`, `Hildir1`… Open set: modded types render with a
 * generic icon.
 */
export const ValheimPinTypeSchema = z.string().regex(/^[A-Za-z0-9_]{1,32}$/);

const worldCoord = z.number().min(-VALHEIM_LINK_WORLD_COORD_MAX).max(VALHEIM_LINK_WORLD_COORD_MAX);

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
    const layers = [['explored', msg.explored], ['sharedExplored', msg.sharedExplored]] as const;
    for (const [name, bmp] of layers) {
        if (bmp && (bmp.width !== size || bmp.height !== size)) {
            ctx.addIssue({ code: 'custom', path: [name], message: 'bitmap size must equal grid.textureSize' });
        }
    }
});
export type ValheimMapMessage = z.infer<typeof ValheimMapMessageSchema>;
