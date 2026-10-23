/**
 * ROK-1930 — the hub Deaths widget (per-player death counts) and the Map
 * tab's server-wide death-pin layer. Read shapes only; NOT part of the
 * LedgerLink `valheim-link/v1` wire format.
 */
import { z } from 'zod';
import { ValheimSteamId64Schema } from './valheim-link-common.schema.js';
import {
    ValheimPinTypeSchema,
    ValheimWorldCoordSchema,
} from './valheim-link-map.schema.js';

const Iso = z.iso.datetime({ offset: true });
const Id = z.number().int().positive();

/** One bar on the Deaths widget (ROK-1930). */
export const ValheimDeathPlayerSchema = z
    .object({
        /** SteamID64; null when no character line could attribute the death (D7). */
        steamId: ValheimSteamId64Schema.nullable(),
        /** Latest character name seen for this player. Display only. */
        name: z.string().min(1).max(64),
        deaths: z.number().int().min(1),
        lastDeathAt: Iso,
        /** The character whose map the bar opens; null → the bar is not a link. */
        characterId: Id.nullable(),
    })
    .strict();
export type ValheimDeathPlayer = z.infer<typeof ValheimDeathPlayerSchema>;

export const ValheimDeathsResponseSchema = z
    .object({
        /** Sorted by deaths desc, then lastDeathAt desc, then name asc. Empty → the widget hides. */
        players: z.array(ValheimDeathPlayerSchema).max(200),
        /** Earliest recorded death on this server (for "counted since" copy); null when none. */
        since: Iso.nullable(),
    })
    .strict();
export type ValheimDeathsResponse = z.infer<typeof ValheimDeathsResponseSchema>;

/** Layer 4: one pin on the server-wide death layer. */
export const ValheimDeathPinSchema = z
    .object({
        x: ValheimWorldCoordSchema,
        z: ValheimWorldCoordSchema,
        steamId: ValheimSteamId64Schema,
        characterName: z.string().min(1).max(64),
        /** Always 'Death' today; typed so ROK-1931 mod positions can share the shape. */
        type: ValheimPinTypeSchema,
    })
    .strict();
export type ValheimDeathPin = z.infer<typeof ValheimDeathPinSchema>;

export const ValheimDeathPinsResponseSchema = z
    .object({
        worldUid: z.string(),
        pins: z.array(ValheimDeathPinSchema).max(2000),
    })
    .strict();
export type ValheimDeathPinsResponse = z.infer<typeof ValheimDeathPinsResponseSchema>;
