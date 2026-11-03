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

describe('CompanionConfigSchema contract plugin + game (T-C-4, ROK-2067)', () => {
    const [contract] = authenticatedConfig.contracts;
    const withContract = (extra: Record<string, unknown>) => ({ ...authenticatedConfig, contracts: [{ ...contract, ...extra }] });
    const plugin = { id: 'bg3', name: "Baldur's Gate 3", state: 'active' };
    const game = { slug: 'baldurs-gate-iii', name: "Baldur's Gate 3", coverUrl: 'https://images.igdb.com/x.jpg' };
    it('accepts plugin + game absent (older server), null, and every plugin state', () => {
        expect(CompanionConfigSchema.safeParse(authenticatedConfig).success).toBe(true);
        expect(CompanionConfigSchema.safeParse(withContract({ plugin: null, game: null })).success).toBe(true);
        for (const state of ['active', 'inactive', 'not_installed']) {
            expect(CompanionConfigSchema.safeParse(withContract({ plugin: { ...plugin, state }, game })).success).toBe(true);
        }
        expect(CompanionConfigSchema.safeParse(withContract({ game: { ...game, coverUrl: null } })).success).toBe(true);
    });
    it('rejects an unknown state and an unknown key inside plugin or game', () => {
        expect(CompanionConfigSchema.safeParse(withContract({ plugin: { ...plugin, state: 'disabled' } })).success).toBe(false);
        expect(CompanionConfigSchema.safeParse(withContract({ plugin: { ...plugin, version: '1.0.0' } })).success).toBe(false);
        expect(CompanionConfigSchema.safeParse(withContract({ game: { ...game, igdbId: 1 } })).success).toBe(false);
        expect(CompanionConfigSchema.safeParse(withContract({ game: { slug: 'x', name: 'X' } })).success).toBe(false);
    });
});

describe('CompanionConfigSchema contract hubTargets + image slot (ROK-1966)', () => {
    const [contract] = authenticatedConfig.contracts;
    const screenshot = { ...contract, id: 'bg3-screenshot', maxBytes: 4096, blobSlots: ['image'] };
    const withTargets = (hubTargets: unknown) => ({ ...authenticatedConfig, contracts: [{ ...screenshot, hubTargets }] });
    const hub = { hubGuildId: 42, name: 'Tavern Crew', isDefault: true };
    it('accepts the image slot, hubTargets absent (older server), empty, and listed', () => {
        expect(CompanionConfigSchema.safeParse({ ...authenticatedConfig, contracts: [screenshot] }).success).toBe(true);
        expect(CompanionConfigSchema.safeParse(withTargets([])).success).toBe(true);
        expect(CompanionConfigSchema.safeParse(withTargets([hub, { ...hub, hubGuildId: 7, isDefault: false }])).success).toBe(true);
    });
    it('rejects a bad hub id, an empty name, a missing isDefault and an unknown key', () => {
        expect(CompanionConfigSchema.safeParse(withTargets([{ ...hub, hubGuildId: 0 }])).success).toBe(false);
        expect(CompanionConfigSchema.safeParse(withTargets([{ ...hub, hubGuildId: '42' }])).success).toBe(false);
        expect(CompanionConfigSchema.safeParse(withTargets([{ ...hub, name: '' }])).success).toBe(false);
        expect(CompanionConfigSchema.safeParse(withTargets([{ hubGuildId: 42, name: 'x' }])).success).toBe(false);
        expect(CompanionConfigSchema.safeParse(withTargets([{ ...hub, slug: 'tavern' }])).success).toBe(false);
    });
});
