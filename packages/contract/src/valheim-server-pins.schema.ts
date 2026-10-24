/**
 * ROK-1943 — the Map tab's cross-player pin layer (`GET …/servers/:id/pins`).
 * Read shape only; NOT part of the LedgerLink wire format.
 *
 * Each map's OWN pins (cartography copies are left out), every type unless
 * `types` narrows it. D13: no SteamID in or out.
 */
import { z } from 'zod';
import { ValheimInt64StringSchema } from './valheim-link-common.schema.js';
import {
    ValheimPinTypeSchema,
    ValheimWorldCoordSchema,
} from './valheim-link-map.schema.js';

/** Most pins one response carries; more → `truncated: true`. */
export const VALHEIM_SERVER_PINS_CAP = 2000;
/** Most character ids one `players` list may name. */
export const VALHEIM_SERVER_PINS_PLAYERS_MAX = 100;
/** Most raw pin types one `types` list may name. */
export const VALHEIM_SERVER_PINS_TYPES_MAX = 32;

const Id = z.number().int().positive();

export const ValheimServerPinSchema = z
    .object({
        x: ValheimWorldCoordSchema,
        z: ValheimWorldCoordSchema,
        type: ValheimPinTypeSchema,
        /** The player's own pin text — user content, never log it. */
        label: z.string().max(64),
        /** The red cross the player toggles on a pin ("crossed out"). */
        checked: z.boolean(),
        /** The character the pin belongs to; null when no profile matches (D13). */
        characterId: Id.nullable(),
        characterName: z.string().min(1).max(64),
    })
    .strict();
export type ValheimServerPin = z.infer<typeof ValheimServerPinSchema>;

export const ValheimServerPinsResponseSchema = z
    .object({
        worldUid: z.string(),
        /** Map id asc, then each map's own pin order. */
        pins: z.array(ValheimServerPinSchema).max(VALHEIM_SERVER_PINS_CAP),
        /** True when more pins matched than `VALHEIM_SERVER_PINS_CAP`. */
        truncated: z.boolean(),
    })
    .strict();
export type ValheimServerPinsResponse = z.infer<typeof ValheimServerPinsResponseSchema>;

/** A non-empty comma list → its items (empty string is invalid, not "all"). */
const commaList = z.string().min(1).transform((s) => s.split(','));
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const PlayerIdSchema = z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(Id.max(2147483647));

export const ValheimServerPinsQuerySchema = z.object({
    worldUid: ValheimInt64StringSchema,
    /** Character (profile) ids; omitted = every map on the world. */
    players: commaList
        .pipe(z.array(PlayerIdSchema).min(1).max(VALHEIM_SERVER_PINS_PLAYERS_MAX))
        .transform(unique)
        .optional(),
    /** Raw pin types; omitted = all types. */
    types: commaList
        .pipe(z.array(ValheimPinTypeSchema).min(1).max(VALHEIM_SERVER_PINS_TYPES_MAX))
        .transform(unique)
        .optional(),
});
export type ValheimServerPinsQuery = z.infer<typeof ValheimServerPinsQuerySchema>;
