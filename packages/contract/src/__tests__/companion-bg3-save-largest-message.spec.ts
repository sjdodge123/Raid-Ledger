import { describe, expect, it } from 'vitest';
import {
    COMPANION_BG3_SAVE_MAX_BYTES,
    COMPANION_IMAGE_EDGE_MAX,
    COMPANION_WEBP_MAX_BYTES,
} from '../companion-common.schema.js';
import {
    BG3_CLASSES_MAX,
    BG3_LEVEL_MAX,
    BG3_PARTY_MAX,
    BG3_SAVE_NAME_MAX_CHARS,
    BG3_XP_MAX,
    Bg3SaveMessageSchema,
} from '../companion-bg3-save.schema.js';
import { lookupCompanionContract } from '../companion-registry.js';

/**
 * ROK-1954 L1 — the LARGEST schema-valid `bg3-save` v1 message (every array
 * full, every string at its max length) fits under the body cap, so the
 * array caps — not the byte cap — bind first.
 */
const MEASURED_BYTES = 33_343;
const id = (c: string): string => c.repeat(64);
const version = `9999.9999.9999-${'b'.repeat(32)}`;
const member = {
    origin: id('O'), race: id('R'), level: BG3_LEVEL_MAX, xpLevel: BG3_XP_MAX, xpTotal: BG3_XP_MAX,
    classes: Array.from({ length: BG3_CLASSES_MAX }, () => ({ main: id('M'), sub: id('S') })),
    isSummon: false,
};
const payload = {
    saveName: 'N'.repeat(BG3_SAVE_NAME_MAX_CHARS),
    savedAt: '2026-10-24T12:00:00.000Z',
    campaignKey: 'f'.repeat(64),
    campaignKeySource: 'save-folder',
    gameVersion: `9999.${'9'.repeat(10)}.${'9'.repeat(10)}.${'9'.repeat(10)}`,
    platform: 'P'.repeat(32),
    currentLevel: id('L'), difficulty: id('D'), ruleset: id('U'),
    party: Array.from({ length: BG3_PARTY_MAX }, () => member),
    thumbnail: {
        sha256: 'a'.repeat(64), byteLength: COMPANION_WEBP_MAX_BYTES, contentType: 'image/webp',
        width: COMPANION_IMAGE_EDGE_MAX, height: COMPANION_IMAGE_EDGE_MAX,
    },
};
const largest = {
    envelopeVersion: 1, contract: 'bg3-save', contractVersion: 1, capturedAt: '2026-10-24T12:00:05.000Z',
    appVersion: version, collectorVersion: version, payload,
};
const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;
const ok = (v: unknown): boolean => Bg3SaveMessageSchema.safeParse(v).success;
const withPayload = (p: Record<string, unknown>) => ({ ...largest, payload: { ...payload, ...p } });

describe('bg3-save v1 largest message (ROK-1954 L1)', () => {
    it('parses and fits under COMPANION_BG3_SAVE_MAX_BYTES', () => {
        expect(ok(largest)).toBe(true);
        expect(bytes(largest)).toBeLessThanOrEqual(COMPANION_BG3_SAVE_MAX_BYTES);
    });
    it('is the registry maxBytes for bg3-save v1', () => {
        const res = lookupCompanionContract('bg3-save', 1);
        if (res.kind !== 'ok') throw new Error(`expected ok, got ${res.kind}`);
        expect(bytes(largest)).toBeLessThanOrEqual(res.spec.maxBytes);
    });
    it('pins the caps that size the largest message', () => {
        expect({ BG3_PARTY_MAX, BG3_CLASSES_MAX, BG3_SAVE_NAME_MAX_CHARS, BG3_LEVEL_MAX, BG3_XP_MAX, COMPANION_BG3_SAVE_MAX_BYTES })
            .toEqual({ BG3_PARTY_MAX: 16, BG3_CLASSES_MAX: 12, BG3_SAVE_NAME_MAX_CHARS: 128, BG3_LEVEL_MAX: 20, BG3_XP_MAX: 10_000_000, COMPANION_BG3_SAVE_MAX_BYTES: 65_536 });
    });
    it('pins the measured size within 10 %', () => {
        expect(Math.abs(bytes(largest) - MEASURED_BYTES)).toBeLessThanOrEqual(MEASURED_BYTES * 0.1);
    });
    it('is truly the largest: one more element or character anywhere fails', () => {
        expect(ok(withPayload({ party: [...payload.party, member] }))).toBe(false);
        expect(ok(withPayload({ party: [{ ...member, classes: [...member.classes, { main: 'X', sub: null }] }] }))).toBe(false);
        expect(ok(withPayload({ saveName: `${payload.saveName}N` }))).toBe(false);
        expect(ok(withPayload({ currentLevel: `${payload.currentLevel}L` }))).toBe(false);
        expect(ok(withPayload({ platform: `${payload.platform}P` }))).toBe(false);
        expect(ok(withPayload({ gameVersion: `${payload.gameVersion}9` }))).toBe(false);
        expect(ok({ ...largest, appVersion: `${version}b` })).toBe(false);
        expect(ok({ ...largest, capturedAt: '2026-10-24T12:00:05.0000Z' })).toBe(false);
    });
});
