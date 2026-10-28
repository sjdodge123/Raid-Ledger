import { describe, expect, it } from 'vitest';
import { COMPANION_MESSAGE_MAX_BYTES } from '../companion-common.schema.js';
import { CompanionEnvelopeSchema } from '../companion-envelope.schema.js';
import { lookupCompanionContract } from '../companion-registry.js';
import {
    COMPANION_WOW_LEDGERLINK_EXPORT_MAX,
    COMPANION_WOW_LEDGERLINK_MAX_BYTES,
    WOW_LEDGERLINK_CONTRACT_ID,
    WOW_LEDGERLINK_CONTRACT_VERSION,
    WowLedgerlinkMessageSchema,
} from '../companion-wow-ledgerlink.schema.js';

/**
 * ROK-1964 — `wow-ledgerlink` v1. The golden + invalid fixture FILES are
 * checked by the api drift guard (`api/src/companion/companion-contract.spec.ts`;
 * this workspace has no Node types to read them); here the schema, the cap
 * and the registry entry are pinned with inline messages.
 */
const CHAR = '!RL1!char!eJxdkMFqwzAMhl9F+Nwy7MRpm9taNtilg+3QQ+lBTZRiFlnFVgfb6LvPKe1hu0nf/0tC/1+ZNA0kRWOWjllPHTYOkfhvo=';
const MIXED = [CHAR, '!RL1!guild-1of1!eJzN289vm0gcBf', '!RL1!raid!eJx1kMFqwzAQRH9F7NmUlhq3W='].join('\n');
const base = {
    envelopeVersion: 1, contract: 'wow-ledgerlink', contractVersion: 1, capturedAt: '2026-10-28T12:00:05Z',
    appVersion: '0.1.0', collectorVersion: '0.1.0', payload: { exportString: CHAR },
};
const withExport = (exportString: unknown) => ({ ...base, payload: { exportString } });
const issuesOf = (v: unknown): string[] =>
    (WowLedgerlinkMessageSchema.safeParse(v).error?.issues ?? []).map((i) => `${i.path.map(String).join('.')}|${i.code}`);
const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

describe('wow-ledgerlink v1 message schema (ROK-1964)', () => {
    it('ids and caps are the spec values (D3)', () => {
        expect([WOW_LEDGERLINK_CONTRACT_ID, WOW_LEDGERLINK_CONTRACT_VERSION]).toEqual(['wow-ledgerlink', 1]);
        expect(COMPANION_WOW_LEDGERLINK_EXPORT_MAX).toBe(260_096);
        expect(COMPANION_WOW_LEDGERLINK_MAX_BYTES).toBe(COMPANION_MESSAGE_MAX_BYTES);
    });

    it.each([
        ['one char token', CHAR],
        ['a mixed char + guild + raid paste (newline-separated)', MIXED],
        ['one character', 'x'],
    ])('accepts %s, as message and as envelope', (_label, exportString) => {
        expect(issuesOf(withExport(exportString))).toEqual([]);
        expect(CompanionEnvelopeSchema.safeParse(withExport(exportString)).error?.issues).toBeUndefined();
    });

    it('passes the export string through unchanged (no trim, no transform)', () => {
        const raw = `${MIXED}\n`;
        expect(WowLedgerlinkMessageSchema.parse(withExport(raw)).payload.exportString).toBe(raw);
    });

    it.each([
        ['envelope unknown key', { ...base, extra: true }, '|unrecognized_keys'],
        ['payload unknown key', { ...base, payload: { exportString: CHAR, ruleset: 'normal' } }, 'payload|unrecognized_keys'],
        ['missing exportString', { ...base, payload: {} }, 'payload.exportString|invalid_type'],
        ['empty exportString', withExport(''), 'payload.exportString|too_small'],
        ['non-string exportString', withExport([CHAR]), 'payload.exportString|invalid_type'],
        ['contractVersion 2', { ...base, contractVersion: 2 }, 'contractVersion|invalid_value'],
        ['another contract id', { ...base, contract: 'bg3-save' }, 'contract|invalid_value'],
    ])('rejects %s at its path + code', (_label, body, expected) => {
        expect(issuesOf(body)).toContain(expected);
    });

    it('enforces the export cap: exactly the cap passes, one over is too_big', () => {
        expect(issuesOf(withExport('A'.repeat(COMPANION_WOW_LEDGERLINK_EXPORT_MAX)))).toEqual([]);
        expect(issuesOf(withExport('A'.repeat(COMPANION_WOW_LEDGERLINK_EXPORT_MAX + 1)))).toEqual([
            'payload.exportString|too_big',
        ]);
    });

    it('the largest valid ASCII message fits the registry maxBytes (D3)', () => {
        const version = `9999.9999.9999-${'b'.repeat(32)}`;
        const largest = {
            ...base, capturedAt: '2026-10-28T12:00:05.000Z', appVersion: version, collectorVersion: version,
            payload: { exportString: 'A'.repeat(COMPANION_WOW_LEDGERLINK_EXPORT_MAX) },
        };
        expect(issuesOf(largest)).toEqual([]);
        expect(bytes(largest)).toBeLessThanOrEqual(COMPANION_WOW_LEDGERLINK_MAX_BYTES);
    });
});

describe('wow-ledgerlink v1 registry entry (ROK-1964)', () => {
    it('resolves to the message schema, global maxBytes, no blobs, current', () => {
        const res = lookupCompanionContract('wow-ledgerlink', 1);
        if (res.kind !== 'ok') throw new Error(`expected ok, got ${res.kind}`);
        expect(res.spec).toEqual({
            schema: WowLedgerlinkMessageSchema, maxBytes: COMPANION_MESSAGE_MAX_BYTES, blobSlots: [], status: 'current',
        });
    });

    it('an unknown version names v1 as current', () => {
        expect(lookupCompanionContract('wow-ledgerlink', 2)).toEqual({ kind: 'unknown_contract_version', current: 1 });
    });
});
