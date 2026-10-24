import { z } from 'zod';
import {
    VALHEIM_LINK_PORTAL_TAG_MAX_CHARS,
    VALHEIM_LINK_PORTALS_MAX,
    ValheimInt64StringSchema,
    ValheimPrefabIdSchema,
    valheimLinkHeaderShape,
} from './valheim-link-common.schema.js';
import { ValheimWorldCoordSchema } from './valheim-link-map.schema.js';

/**
 * ROK-1944 — `kind: "portals"`: every portal in the world, found by the
 * mod's server-side scan alongside `containers` (every ~10 minutes), keyed
 * (`serverId`, `worldUid`). Each message is a FULL snapshot — the latest
 * `capturedAt` replaces the world's portals wholesale, so a destroyed portal
 * simply disappears; there are no deltas. `capturedAt` is the scan time.
 * ADDITIVE under CONTRACT.md §9: the server ships first.
 */

export const ValheimPortalSchema = z.object({
    /** `portal_wood`, `portal_stone`, or a modded portal prefab the scan recognises. */
    prefab: ValheimPrefabIdSchema,
    x: ValheimWorldCoordSchema,
    /** Height; `null` when the scan has no height for this portal. */
    y: ValheimWorldCoordSchema.nullable(),
    z: ValheimWorldCoordSchema,
    /** The portal's tag (pairing name) as typed in game; may be empty. Free text. */
    tag: z.string().max(VALHEIM_LINK_PORTAL_TAG_MAX_CHARS),
}).strict();
export type ValheimPortal = z.infer<typeof ValheimPortalSchema>;

export const ValheimPortalsMessageSchema = z.object({
    ...valheimLinkHeaderShape,
    kind: z.literal('portals'),
    /** The world scanned (int64 string, as on `containers`). */
    worldUid: ValheimInt64StringSchema,
    /** May be empty: a world with no portals. */
    portals: z.array(ValheimPortalSchema).max(VALHEIM_LINK_PORTALS_MAX),
    /** Portals the mod dropped above `VALHEIM_LINK_PORTALS_MAX`. */
    omitted: z.number().int().min(0).max(1_000_000),
}).strict().superRefine((msg, ctx) => {
    const seen = new Set<string>();
    msg.portals.forEach((p, i) => {
        const key = `${p.prefab}|${p.x}|${p.y ?? ''}|${p.z}`;
        if (seen.has(key)) {
            ctx.addIssue({ code: 'custom', path: ['portals', i], message: 'duplicate portal (prefab, position)' });
        }
        seen.add(key);
    });
});
export type ValheimPortalsMessage = z.infer<typeof ValheimPortalsMessageSchema>;
