import { z } from 'zod';
import {
    VALHEIM_LINK_PORTAL_TAG_MAX_CHARS,
    VALHEIM_LINK_PORTALS_MAX,
    ValheimInt64StringSchema,
    ValheimPrefabIdSchema,
} from './valheim-link-common.schema.js';
import { ValheimWorldCoordSchema } from './valheim-link-map.schema.js';

/**
 * ROK-1946 — the Map tab's scanned-portal layer:
 * `GET plugins/valheim/armory/servers/:serverId/portals?worldUid=`.
 * Read shape only; NOT part of the LedgerLink wire format.
 */

/** One portal from the server's latest scan of the world. */
export const ValheimServerPortalSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    x: ValheimWorldCoordSchema,
    /** Height; `null` when the scan had none. */
    y: ValheimWorldCoordSchema.nullable(),
    z: ValheimWorldCoordSchema,
    /** The in-game tag — user content, never log it. May be empty. */
    tag: z.string().max(VALHEIM_LINK_PORTAL_TAG_MAX_CHARS),
}).strict();
export type ValheimServerPortal = z.infer<typeof ValheimServerPortalSchema>;

/**
 * The world's latest scan, portals ordered x, z. No scan yet → `scannedAt:
 * null`, `portals: []` (200, not 404). `worldUid` is the world served —
 * the requested one, else the server's newest scan; null when it has none.
 */
export const ValheimServerPortalsResponseSchema = z.object({
    worldUid: z.string().nullable(),
    scannedAt: z.string().datetime().nullable(),
    /** Portals the mod left out of the scan (its cap). */
    omitted: z.number().int().min(0),
    portals: z.array(ValheimServerPortalSchema).max(VALHEIM_LINK_PORTALS_MAX),
}).strict();
export type ValheimServerPortalsResponse = z.infer<
    typeof ValheimServerPortalsResponseSchema
>;

/** Query: `worldUid` optional — omitted means the server's newest scan. */
export const ValheimServerPortalsQuerySchema = z.object({
    worldUid: ValheimInt64StringSchema.optional(),
});
export type ValheimServerPortalsQuery = z.infer<
    typeof ValheimServerPortalsQuerySchema
>;
