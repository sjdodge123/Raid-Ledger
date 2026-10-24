import { describe, expect, it } from 'vitest';
import { VALHEIM_LINK_PORTAL_TAG_MAX_CHARS, VALHEIM_LINK_PORTALS_MAX } from '../valheim-link-common.schema.js';
import { ValheimLinkMessageKindSchema, ValheimLinkMessageSchema } from '../valheim-link-message.schema.js';

/** ROK-1944 — the `portals` kind: bounds, strict keys and the uniqueness refinement. */
const portal = (x: number, extra: Record<string, unknown> = {}) => ({ prefab: 'portal_wood', x, y: 30, z: 48, tag: 'home', ...extra });
const basic = {
    schemaVersion: 1, serverId: 'srv_fixture_01', capturedAt: '2026-10-17T20:15:00Z', gameVersion: '0.220.5', modVersion: '1.0.0',
    kind: 'portals', worldUid: '1234567890123', portals: [portal(1), portal(2, { tag: '' })], omitted: 0,
};
const issue = (msg: unknown, path: string, code: string): boolean => {
    const res = ValheimLinkMessageSchema.safeParse(msg);
    return !res.success && res.error.issues.some((i) => i.path.join('.') === path && i.code === code);
};

describe('ValheimPortalsMessageSchema (ROK-1944)', () => {
    it('is a member of the message union and of the kind enum', () => {
        expect(ValheimLinkMessageSchema.safeParse(basic).success).toBe(true);
        expect(ValheimLinkMessageKindSchema.options).toContain('portals');
    });
    it('accepts an empty world, an empty tag, a null height and a modded prefab', () => {
        expect(ValheimLinkMessageSchema.safeParse({ ...basic, portals: [] }).success).toBe(true);
        expect(ValheimLinkMessageSchema.safeParse({ ...basic, portals: [portal(1, { y: null, prefab: 'portal_blackmarble' })] }).success).toBe(true);
    });
    it('rejects a duplicate (prefab, position) even when the tags differ', () => {
        expect(issue({ ...basic, portals: [portal(1), portal(1, { tag: 'other' })] }, 'portals.1', 'custom')).toBe(true);
    });
    it('bounds the tag length and the portal count', () => {
        const long = 'x'.repeat(VALHEIM_LINK_PORTAL_TAG_MAX_CHARS + 1);
        expect(issue({ ...basic, portals: [portal(1, { tag: long })] }, 'portals.0.tag', 'too_big')).toBe(true);
        const many = Array.from({ length: VALHEIM_LINK_PORTALS_MAX + 1 }, (_, i) => portal(i));
        expect(issue({ ...basic, portals: many }, 'portals', 'too_big')).toBe(true);
    });
    it('rejects unknown keys on a portal and on the message', () => {
        expect(issue({ ...basic, portals: [portal(1, { target: 'home' })] }, 'portals.0', 'unrecognized_keys')).toBe(true);
        expect(issue({ ...basic, pairs: [] }, '', 'unrecognized_keys')).toBe(true);
    });
});
