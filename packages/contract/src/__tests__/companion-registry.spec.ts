import { describe, expect, it } from 'vitest';
import { COMPANION_BG3_SAVE_MAX_BYTES } from '../companion-common.schema.js';
import { Bg3SaveMessageSchema } from '../companion-bg3-save.schema.js';
import { COMPANION_CONTRACTS, lookupCompanionContract } from '../companion-registry.js';
import type { CompanionContractTable } from '../companion-registry.js';

/** ROK-1954 — the shared contract registry (R1–R4). */
const synthetic: CompanionContractTable = {
    'demo-world': {
        1: { schema: Bg3SaveMessageSchema, maxBytes: 10, blobSlots: [], status: 'retired' },
        2: { schema: Bg3SaveMessageSchema, maxBytes: 10, blobSlots: [], status: 'accepted' },
        3: { schema: Bg3SaveMessageSchema, maxBytes: 10, blobSlots: [], status: 'current' },
    },
};

describe('lookupCompanionContract (ROK-1954)', () => {
    it('R1: bg3-save v1 resolves to the full message schema', () => {
        const res = lookupCompanionContract('bg3-save', 1);
        expect(res.kind).toBe('ok');
        if (res.kind !== 'ok') throw new Error(`expected ok, got ${res.kind}`);
        expect(res.spec.schema).toBe(Bg3SaveMessageSchema);
        expect(res.spec).toEqual({ schema: Bg3SaveMessageSchema, maxBytes: COMPANION_BG3_SAVE_MAX_BYTES, blobSlots: ['thumbnail'], status: 'current' });
    });
    it('R1: the shipped table holds exactly bg3-save v1', () => {
        expect(Object.keys(COMPANION_CONTRACTS)).toEqual(['bg3-save']);
        expect(Object.keys(COMPANION_CONTRACTS['bg3-save'] ?? {})).toEqual(['1']);
    });
    it('R2: an unknown version of a known contract names the current one', () => {
        expect(lookupCompanionContract('bg3-save', 2)).toEqual({ kind: 'unknown_contract_version', current: 1 });
        expect(lookupCompanionContract('bg3-save', 0)).toEqual({ kind: 'unknown_contract_version', current: 1 });
        expect(lookupCompanionContract('bg3-save', 1.5)).toEqual({ kind: 'unknown_contract_version', current: 1 });
    });
    it('R3: unknown ids and prototype keys are unknown_contract', () => {
        for (const id of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
            expect(lookupCompanionContract(id, 1), id).toEqual({ kind: 'unknown_contract' });
        }
    });
    it('R3: prototype keys on the version map are not versions', () => {
        expect(lookupCompanionContract('bg3-save', Number('constructor'))).toEqual({ kind: 'unknown_contract_version', current: 1 });
    });
    it('R4: a retired version reports retired with the current version', () => {
        expect(lookupCompanionContract('demo-world', 1, synthetic)).toEqual({ kind: 'retired', current: 3 });
    });
    it('R4: accepted and current versions both resolve ok', () => {
        expect(lookupCompanionContract('demo-world', 2, synthetic).kind).toBe('ok');
        expect(lookupCompanionContract('demo-world', 3, synthetic).kind).toBe('ok');
        expect(lookupCompanionContract('demo-world', 4, synthetic)).toEqual({ kind: 'unknown_contract_version', current: 3 });
    });
});
