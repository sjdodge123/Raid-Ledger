import { describe, expect, it } from 'vitest';
import { CompanionEnvelopeSchema, CompanionIngestAckSchema, CompanionIngestErrorCodeSchema } from '../companion-envelope.schema.js';

/** ROK-1954 — the companion envelope (E1–E7): strict keys, open contract id, version strings, ack + error codes. */
const base = {
    envelopeVersion: 1, contract: 'bg3-save', contractVersion: 1, capturedAt: '2026-10-24T12:00:05Z',
    appVersion: '0.1.0', collectorVersion: '0.1.0', payload: {},
};
const issue = (msg: unknown, path: string, code: string): boolean => {
    const res = CompanionEnvelopeSchema.safeParse(msg);
    return !res.success && res.error.issues.some((i) => i.path.join('.') === path && i.code === code);
};
const ok = (msg: unknown): boolean => CompanionEnvelopeSchema.safeParse(msg).success;

describe('CompanionEnvelopeSchema (ROK-1954)', () => {
    it('E1: accepts a minimal envelope with an empty payload', () => {
        expect(ok(base)).toBe(true);
    });
    it('E1: requires the payload key to be present', () => {
        const { payload: _payload, ...noPayload } = base;
        expect(ok(noPayload)).toBe(false);
    });
    it('E2: rejects envelopeVersion 2 at envelopeVersion', () => {
        expect(issue({ ...base, envelopeVersion: 2 }, 'envelopeVersion', 'invalid_value')).toBe(true);
    });
    it('E3: rejects an extra top-level key', () => {
        expect(issue({ ...base, token: 'x' }, '', 'unrecognized_keys')).toBe(true);
    });
    it('E4: contract is an open but bounded lowercase id', () => {
        expect(issue({ ...base, contract: 'BG3' }, 'contract', 'invalid_format')).toBe(true);
        expect(issue({ ...base, contract: '' }, 'contract', 'invalid_format')).toBe(true);
        expect(issue({ ...base, contract: `a${'b'.repeat(40)}` }, 'contract', 'invalid_format')).toBe(true);
        expect(ok({ ...base, contract: `a${'b'.repeat(39)}` })).toBe(true);
        expect(ok({ ...base, contract: 'minecraft-world' })).toBe(true);
    });
    it('E4: contractVersion is an integer 1..999', () => {
        expect(issue({ ...base, contractVersion: 0 }, 'contractVersion', 'too_small')).toBe(true);
        expect(issue({ ...base, contractVersion: 1000 }, 'contractVersion', 'too_big')).toBe(true);
        expect(ok({ ...base, contractVersion: 7 })).toBe(true);
    });
    it('E5: capturedAt must be UTC Z with at most millisecond precision', () => {
        expect(issue({ ...base, capturedAt: '2026-10-24T12:00:05+02:00' }, 'capturedAt', 'invalid_format')).toBe(true);
        expect(issue({ ...base, capturedAt: '2026-10-24T12:00:05.1234Z' }, 'capturedAt', 'too_big')).toBe(true);
        expect(ok({ ...base, capturedAt: '2026-10-24T12:00:05.123Z' })).toBe(true);
    });
    it('E6: appVersion and collectorVersion are semver core + optional pre-release', () => {
        expect(issue({ ...base, appVersion: '1.2' }, 'appVersion', 'invalid_format')).toBe(true);
        expect(ok({ ...base, appVersion: `1.2.3-${'a'.repeat(43)}` })).toBe(false);
        expect(issue({ ...base, collectorVersion: 'v1.0.0' }, 'collectorVersion', 'invalid_format')).toBe(true);
        expect(ok({ ...base, appVersion: '1.2.3-beta.1', collectorVersion: '10.20.30' })).toBe(true);
    });
});

describe('Companion ingest ack + error codes (ROK-1954)', () => {
    it('E7: the ack accepts only accepted/stale and is strict', () => {
        expect(CompanionIngestAckSchema.safeParse({ status: 'accepted' }).success).toBe(true);
        expect(CompanionIngestAckSchema.safeParse({ status: 'stale' }).success).toBe(true);
        expect(CompanionIngestAckSchema.safeParse({ status: 'rejected' }).success).toBe(false);
        expect(CompanionIngestAckSchema.safeParse({ status: 'accepted', id: 1 }).success).toBe(false);
    });
    it('E7: the error-code enum is pinned exactly (codes are wire)', () => {
        expect(CompanionIngestErrorCodeSchema.options).toEqual([
            'invalid_envelope', 'unknown_contract', 'unknown_contract_version', 'retired_contract_version',
            'invalid_payload', 'payload_too_large', 'captured_at_in_future', 'unauthorized', 'rate_limited',
        ]);
    });
});
