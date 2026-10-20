import { describe, expect, it } from 'vitest';
import {
    VALHEIM_LINK_CONTAINER_ENTRIES_MAX,
    VALHEIM_LINK_CONTAINER_ITEMS_MAX,
} from '../valheim-link-common.schema.js';
import { ValheimContainersMessageSchema } from '../valheim-link-containers.schema.js';
import { ValheimLinkMessageKindSchema, ValheimLinkMessageSchema } from '../valheim-link-message.schema.js';

/** ROK-1853 — the `containers` kind: refinements the JSON schema cannot express. */
const chest = { prefab: 'piece_chest_wood', x: -12.25, y: 32.5, z: 48, creatorPlayerId: '1000000000000001', privacy: 'public', vehicle: false, slots: 30, usedSlots: 2, unreadable: false, omittedEntries: 0, items: [{ prefab: 'Wood', quality: 1, stack: 50 }, { prefab: 'Stone', quality: 1, stack: 20 }] };
const basic = {
    schemaVersion: 1, serverId: 'srv_fixture_01', capturedAt: '2026-10-17T20:15:00Z', gameVersion: '0.220.5', modVersion: '1.0.0',
    kind: 'containers', worldUid: '1234567890123', containers: [chest], omittedShared: 0, omittedPrivate: 0,
};
const withContainers = (containers: unknown[]) => ({ ...basic, containers });
const first = () => structuredClone(chest);

describe('ValheimContainersMessageSchema (ROK-1853)', () => {
    it('is a member of the message union and of the kind enum', () => {
        expect(ValheimLinkMessageSchema.safeParse(basic).success).toBe(true);
        expect(ValheimLinkMessageKindSchema.options).toContain('containers');
    });

    it('accepts an empty world', () => {
        expect(ValheimContainersMessageSchema.safeParse(withContainers([])).success).toBe(true);
    });

    it('caps the items summed over all containers, not just per container', () => {
        const perContainer = VALHEIM_LINK_CONTAINER_ITEMS_MAX;
        const containers = Math.ceil((VALHEIM_LINK_CONTAINER_ENTRIES_MAX + 1) / perContainer);
        const many = Array.from({ length: containers }, (_, i) => ({
            ...first(),
            x: i,
            items: Array.from({ length: perContainer }, (_, j) => ({ prefab: `p${j}`, quality: 1, stack: 1 })),
        }));
        const res = ValheimContainersMessageSchema.safeParse(withContainers(many));
        expect(res.success).toBe(false);
        expect(res.error?.issues.some((i) => i.code === 'too_big' && i.path.join('.') === 'containers')).toBe(true);
    });

    it('an unreadable container carries no items and no used slots', () => {
        const bad = { ...first(), unreadable: true };
        expect(ValheimContainersMessageSchema.safeParse(withContainers([bad])).success).toBe(false);
        const ok = { ...first(), unreadable: true, items: [], usedSlots: 0 };
        expect(ValheimContainersMessageSchema.safeParse(withContainers([ok])).success).toBe(true);
    });

    it('two creators may own chests at the same spot; one creator may not', () => {
        const a = first();
        const b = { ...first(), creatorPlayerId: '1000000000000009' };
        expect(ValheimContainersMessageSchema.safeParse(withContainers([a, b])).success).toBe(true);
        expect(ValheimContainersMessageSchema.safeParse(withContainers([a, first()])).success).toBe(false);
    });
});
