import { describe, expect, it } from 'vitest';
import {
    ValheimFileIconSchema,
    ValheimItemsMessageSchema,
} from '../valheim-link-items.schema.js';

/**
 * ROK-1833 — a `file` icon may carry an optional blob reference (the same
 * `ValheimBinaryRefSchema` the base map and atlas use) so its PNG uploads
 * through the content-addressed blob route. Additive: omitting it stays valid.
 */
const blob = {
    sha256: 'c'.repeat(64),
    byteLength: 4096,
    contentType: 'image/png',
    width: 64,
    height: 64,
};
const fileIcon = { kind: 'file', file: 'SwordIron.png' };

const itemsMessage = (icon: unknown): unknown => ({
    schemaVersion: 1,
    serverId: 'srv_fixture_01',
    capturedAt: '2026-10-17T20:15:00Z',
    gameVersion: '0.220.5',
    modVersion: '1.0.0',
    kind: 'items',
    locale: 'English',
    atlas: null,
    items: [{
        prefab: 'SwordIron', name: 'Iron sword', category: 'OneHandedWeapon',
        maxStack: 1, maxQuality: 4, variants: 0, icon,
    }],
});

describe('ValheimFileIconSchema blob reference (ROK-1833)', () => {
    it('parses a file icon with a blob reference', () => {
        expect(ValheimFileIconSchema.safeParse({ ...fileIcon, blob }).success).toBe(true);
    });

    it('parses a file icon without a blob reference', () => {
        expect(ValheimFileIconSchema.safeParse(fileIcon).success).toBe(true);
    });

    it.each([
        ['short sha256', { ...blob, sha256: 'c'.repeat(63) }],
        ['non-png content type', { ...blob, contentType: 'image/jpeg' }],
        ['zero byteLength', { ...blob, byteLength: 0 }],
        ['missing height', { sha256: blob.sha256, byteLength: 1, contentType: 'image/png', width: 1 }],
        ['unknown key', { ...blob, extra: true }],
        ['null', null],
    ])('rejects a malformed blob reference: %s', (_name, bad) => {
        expect(ValheimFileIconSchema.safeParse({ ...fileIcon, blob: bad }).success).toBe(false);
    });

    it('keeps the file icon strict', () => {
        expect(ValheimFileIconSchema.safeParse({ ...fileIcon, sha256: blob.sha256 }).success).toBe(false);
    });

    it('accepts the referenced icon inside a full items message', () => {
        const result = ValheimItemsMessageSchema.safeParse(itemsMessage({ ...fileIcon, blob }));
        expect(result.error?.issues ?? []).toEqual([]);
    });

    it('reports the malformed reference path inside a full items message', () => {
        const result = ValheimItemsMessageSchema.safeParse(
            itemsMessage({ ...fileIcon, blob: { ...blob, sha256: 'nope' } }),
        );
        const paths = (result.error?.issues ?? []).map((i) => i.path.map(String).join('.'));
        expect(paths).toContain('items.0.icon.blob.sha256');
    });
});
