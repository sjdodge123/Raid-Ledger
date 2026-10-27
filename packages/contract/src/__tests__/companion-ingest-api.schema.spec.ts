import { describe, expect, it } from 'vitest';
import { CompanionIngestErrorCodeSchema } from '../companion-envelope.schema.js';
import {
    CompanionBlobAckSchema,
    CompanionConfigSchema,
    CompanionIngestErrorSchema,
} from '../companion-ingest-api.schema.js';

/** ROK-1956 — ingest error body, blob ack and `/config` (T-C-1..3). */

const SHA = 'a'.repeat(64);

const anonymousConfig = {
    configVersion: 1,
    minAppVersion: '0.0.0',
    limits: {
        messageMaxBytes: 262_144,
        webpMaxBytes: 1_048_576,
        imageEdgeMax: 4096,
        capturedAtMaxFutureMs: 300_000,
    },
};

const authenticatedConfig = {
    ...anonymousConfig,
    rate: { messagesPerMin: 30, blobsPerMin: null },
    contracts: [{
        id: 'bg3-save',
        enabled: true,
        versions: [{ version: 1, status: 'current' }],
        maxBytes: 65_536,
        blobSlots: ['thumbnail'],
        cadence: { minIntervalSec: 120 },
    }],
};

describe('CompanionIngestErrorSchema (T-C-1, T-C-2)', () => {
    it('T-C-1: every error code round-trips', () => {
        for (const code of CompanionIngestErrorCodeSchema.options) {
            const body = { code, message: `m ${code}` };
            expect(CompanionIngestErrorSchema.parse(body)).toEqual(body);
        }
    });
    it('T-C-1: accepts currentVersion and issues; rejects an unknown key or code', () => {
        const ok = { code: 'retired_contract_version', message: 'x', currentVersion: 2 };
        expect(CompanionIngestErrorSchema.safeParse(ok).success).toBe(true);
        expect(CompanionIngestErrorSchema.safeParse({ ...ok, detail: 'y' }).success).toBe(false);
        expect(CompanionIngestErrorSchema.safeParse({ code: 'bad_gzip', message: 'x' }).success).toBe(false);
        expect(CompanionIngestErrorSchema.safeParse({ ...ok, currentVersion: 0 }).success).toBe(false);
        expect(CompanionIngestErrorSchema.safeParse({ code: 'unauthorized', message: 'x'.repeat(201) }).success).toBe(false);
    });
    it('T-C-2: issues are capped at 20 and carry only path + code (never values)', () => {
        const issue = { path: 'payload.party.0.name', code: 'too_big' };
        const base = { code: 'invalid_payload', message: 'x' };
        expect(CompanionIngestErrorSchema.safeParse({ ...base, issues: Array(20).fill(issue) }).success).toBe(true);
        expect(CompanionIngestErrorSchema.safeParse({ ...base, issues: Array(21).fill(issue) }).success).toBe(false);
        expect(CompanionIngestErrorSchema.safeParse({ ...base, issues: [{ ...issue, received: 'Shadowheart' }] }).success).toBe(false);
        expect(CompanionIngestErrorSchema.safeParse({ ...base, issues: [{ ...issue, code: 'c'.repeat(41) }] }).success).toBe(false);
    });
});

describe('CompanionBlobAckSchema', () => {
    it('accepts stored/exists with a lowercase sha256 and is strict', () => {
        expect(CompanionBlobAckSchema.safeParse({ status: 'stored', sha256: SHA }).success).toBe(true);
        expect(CompanionBlobAckSchema.safeParse({ status: 'exists', sha256: SHA }).success).toBe(true);
        expect(CompanionBlobAckSchema.safeParse({ status: 'accepted', sha256: SHA }).success).toBe(false);
        expect(CompanionBlobAckSchema.safeParse({ status: 'stored', sha256: SHA.toUpperCase() }).success).toBe(false);
        expect(CompanionBlobAckSchema.safeParse({ status: 'stored', sha256: SHA, path: '/x' }).success).toBe(false);
    });
});

describe('CompanionConfigSchema (T-C-3)', () => {
    it('accepts the anonymous shape (no rate, no contracts)', () => {
        expect(CompanionConfigSchema.parse(anonymousConfig)).toEqual(anonymousConfig);
    });
    it('accepts the authenticated shape', () => {
        expect(CompanionConfigSchema.parse(authenticatedConfig)).toEqual(authenticatedConfig);
    });
    it('rejects an unknown key at every level', () => {
        expect(CompanionConfigSchema.safeParse({ ...anonymousConfig, admin: true }).success).toBe(false);
        expect(CompanionConfigSchema.safeParse({ ...anonymousConfig, limits: { ...anonymousConfig.limits, x: 1 } }).success).toBe(false);
        const [contract] = authenticatedConfig.contracts;
        expect(CompanionConfigSchema.safeParse({ ...authenticatedConfig, contracts: [{ ...contract, owner: 'bg3' }] }).success).toBe(false);
    });
    it('rejects configVersion 2, a bad contract id and an unknown blob slot', () => {
        expect(CompanionConfigSchema.safeParse({ ...anonymousConfig, configVersion: 2 }).success).toBe(false);
        const [contract] = authenticatedConfig.contracts;
        expect(CompanionConfigSchema.safeParse({ ...authenticatedConfig, contracts: [{ ...contract, id: 'BG3' }] }).success).toBe(false);
        expect(CompanionConfigSchema.safeParse({ ...authenticatedConfig, contracts: [{ ...contract, blobSlots: ['portrait'] }] }).success).toBe(false);
    });
});
