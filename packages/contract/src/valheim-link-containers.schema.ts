import { z } from 'zod';
import {
    VALHEIM_LINK_CONTAINER_ENTRIES_MAX,
    VALHEIM_LINK_CONTAINER_ITEMS_MAX,
    VALHEIM_LINK_CONTAINER_SLOTS_MAX,
    VALHEIM_LINK_CONTAINERS_MAX,
    ValheimInt64StringSchema,
    ValheimPrefabIdSchema,
    valheimLinkHeaderShape,
} from './valheim-link-common.schema.js';
import { ValheimWorldCoordSchema } from './valheim-link-map.schema.js';

/**
 * ROK-1853 — `kind: "containers"`: every player-built container on the
 * dedicated server, scanned every 10 minutes and always sent, keyed
 * (`serverId`, `worldUid`); the latest `capturedAt` wins. Stacks arrive
 * aggregated per (`prefab`, `quality`); Raid Ledger computes totals. ADDITIVE
 * under CONTRACT.md §9 — the mod emits it only after its pin refresh.
 */

/** `private` chests are owner + admin only at read time; `group` counts as shared. */
export const ValheimContainerPrivacySchema = z.enum(['public', 'private', 'group']);
export type ValheimContainerPrivacy = z.infer<typeof ValheimContainerPrivacySchema>;

/** One aggregated stack: every item of this prefab at this quality in the container. */
export const ValheimContainerStackSchema = z.object({
    prefab: ValheimPrefabIdSchema,
    quality: z.number().int().min(1).max(10),
    stack: z.number().int().min(1).max(1_000_000_000),
}).strict();
export type ValheimContainerStack = z.infer<typeof ValheimContainerStackSchema>;

export const ValheimContainerSchema = z.object({
    /** The container piece (`piece_chest`, `Cart`, …). */
    prefab: ValheimPrefabIdSchema,
    x: ValheimWorldCoordSchema,
    /** Height. */
    y: ValheimWorldCoordSchema,
    z: ValheimWorldCoordSchema,
    /** The builder's `playerId` — the same id the `character` kind carries; never `0`. */
    creatorPlayerId: ValheimInt64StringSchema.refine((v) => v !== '0', { message: 'creatorPlayerId must not be 0' }),
    privacy: ValheimContainerPrivacySchema,
    /** Carts and ships. */
    vehicle: z.boolean(),
    slots: z.number().int().min(1).max(VALHEIM_LINK_CONTAINER_SLOTS_MAX),
    usedSlots: z.number().int().min(0).max(VALHEIM_LINK_CONTAINER_SLOTS_MAX),
    /** The mod could not decode the contents: `items` is empty and `usedSlots` is 0. */
    unreadable: z.boolean(),
    /** Entries dropped above `VALHEIM_LINK_CONTAINER_ITEMS_MAX`. */
    omittedEntries: z.number().int().min(0).max(100_000_000),
    items: z.array(ValheimContainerStackSchema).max(VALHEIM_LINK_CONTAINER_ITEMS_MAX),
}).strict().superRefine((c, ctx) => {
    if (c.usedSlots > c.slots) {
        ctx.addIssue({ code: 'custom', path: ['usedSlots'], message: 'usedSlots exceeds slots' });
    }
    if (c.unreadable && (c.items.length > 0 || c.usedSlots !== 0)) {
        ctx.addIssue({ code: 'custom', path: ['items'], message: 'an unreadable container carries no items' });
    }
    const seen = new Set<string>();
    c.items.forEach((s, i) => {
        const key = `${s.prefab}@${s.quality}`;
        if (seen.has(key)) ctx.addIssue({ code: 'custom', path: ['items', i], message: 'duplicate (prefab, quality) stack' });
        seen.add(key);
    });
});
export type ValheimContainer = z.infer<typeof ValheimContainerSchema>;

export const ValheimContainersMessageSchema = z.object({
    ...valheimLinkHeaderShape,
    kind: z.literal('containers'),
    /** The world scanned (int64 string, as on `character` / `map`). */
    worldUid: ValheimInt64StringSchema,
    /** May be empty on a fresh world. */
    containers: z.array(ValheimContainerSchema).max(VALHEIM_LINK_CONTAINERS_MAX),
    /** Containers the mod dropped at its own count caps, by privacy. */
    omittedShared: z.number().int().min(0).max(1_000_000),
    omittedPrivate: z.number().int().min(0).max(1_000_000),
}).strict().superRefine((msg, ctx) => {
    const seen = new Set<string>();
    let entries = 0;
    msg.containers.forEach((c, i) => {
        const key = `${c.prefab}|${c.x}|${c.y}|${c.z}|${c.creatorPlayerId}`;
        if (seen.has(key)) {
            ctx.addIssue({ code: 'custom', path: ['containers', i], message: 'duplicate container (prefab, position, creator)' });
        }
        seen.add(key);
        entries += c.items.length;
    });
    if (entries > VALHEIM_LINK_CONTAINER_ENTRIES_MAX) {
        ctx.addIssue({
            code: 'too_big',
            origin: 'array',
            maximum: VALHEIM_LINK_CONTAINER_ENTRIES_MAX,
            inclusive: true,
            path: ['containers'],
            message: `items summed over all containers exceed ${VALHEIM_LINK_CONTAINER_ENTRIES_MAX}`,
        });
    }
});
export type ValheimContainersMessage = z.infer<typeof ValheimContainersMessageSchema>;
