/**
 * ROK-1738 — the create-from-export route's request/result. The new request
 * schema adds an optional, selectable `ruleset`; the ROK-1724 per-character
 * schema must stay strict and keep rejecting that key.
 */
import { describe, it, expect } from 'vitest';
import {
    AddonImportErrorCodeSchema,
    AddonImportNewRequestSchema,
    AddonImportNewResultSchema,
    AddonImportRequestSchema,
    AddonImportTargetSchema,
} from '../index.js';

const base = { importString: '!RL1!char!AAAA' };
const target = {
    action: 'create',
    characterId: null,
    name: 'Ana Forever',
    region: 'us',
    ruleset: null,
    class: 'Paladin',
    level: 60,
};

describe('AddonImportNewRequestSchema', () => {
    it('accepts a selectable ruleset and defaults dryRun to true', () => {
        const parsed = AddonImportNewRequestSchema.parse({ ...base, ruleset: 'pvp' });
        expect(parsed).toEqual({ ...base, ruleset: 'pvp', dryRun: true });
        expect(AddonImportNewRequestSchema.parse(base).ruleset).toBeUndefined();
    });

    it('rejects hardcore (not selectable) and an unknown ruleset', () => {
        expect(AddonImportNewRequestSchema.safeParse({ ...base, ruleset: 'hardcore' }).success).toBe(false);
        expect(AddonImportNewRequestSchema.safeParse({ ...base, ruleset: 'seasonal' }).success).toBe(false);
    });

    it('still rejects unknown keys (strict) at the top level and in confirm', () => {
        expect(AddonImportNewRequestSchema.safeParse({ ...base, force: true }).success).toBe(false);
        expect(AddonImportNewRequestSchema.safeParse({ ...base, confirm: { skip: true } }).success).toBe(false);
    });
});

describe('AddonImportRequestSchema (ROK-1724 per-character route) stays strict', () => {
    it('rejects a ruleset key', () => {
        expect(AddonImportRequestSchema.safeParse({ ...base, ruleset: 'pvp' }).success).toBe(false);
    });
});

describe('AddonImportTargetSchema + AddonImportNewResultSchema', () => {
    it('accepts a create preview target with a null ruleset and null id', () => {
        expect(AddonImportTargetSchema.parse(target)).toEqual(target);
    });

    it('rejects an unknown action and a non-uuid characterId', () => {
        expect(AddonImportTargetSchema.safeParse({ ...target, action: 'merge' }).success).toBe(false);
        expect(AddonImportTargetSchema.safeParse({ ...target, characterId: 'abc' }).success).toBe(false);
    });

    it('is the ROK-1724 result plus a required target', () => {
        const result = {
            section: 'char',
            status: 'preview',
            exportedAt: 1_790_000_000,
            warnings: [],
            diff: {},
            summary: { gearCount: 0, avgIlvl: null, talentNodes: 0, lockouts: 0 },
        };
        expect(AddonImportNewResultSchema.safeParse({ ...result, target }).success).toBe(true);
        expect(AddonImportNewResultSchema.safeParse(result).success).toBe(false);
    });
});

describe('AddonImportErrorCodeSchema (ROK-1738 codes)', () => {
    it('includes CHARACTER_CLAIMED and RULESET_REQUIRED', () => {
        expect(AddonImportErrorCodeSchema.options).toEqual(
            expect.arrayContaining(['CHARACTER_CLAIMED', 'RULESET_REQUIRED']),
        );
    });
});
