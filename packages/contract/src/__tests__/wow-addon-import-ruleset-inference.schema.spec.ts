/**
 * ROK-2100 — a companion upload's ruleset can be inferred from the realm's
 * own name. `source: 'realm-name'` is an additive response-only value.
 */
import { describe, it, expect } from 'vitest';
import { AddonImportRulesetInferenceSchema } from '../index.js';

const base = { ruleset: 'rppvp', realmName: 'CAMWOW US2 Realm 9 RP PvP' };

describe('AddonImportRulesetInferenceSchema.source', () => {
    it('accepts the realm-name source (ROK-2100)', () => {
        expect(AddonImportRulesetInferenceSchema.safeParse({ ...base, source: 'realm-name' }).success).toBe(true);
    });

    it('still accepts realm-map and blizzard', () => {
        expect(AddonImportRulesetInferenceSchema.safeParse({ ...base, source: 'realm-map' }).success).toBe(true);
        expect(AddonImportRulesetInferenceSchema.safeParse({ ...base, source: 'blizzard' }).success).toBe(true);
    });

    it('rejects an unknown source', () => {
        expect(AddonImportRulesetInferenceSchema.safeParse({ ...base, source: 'guess' }).success).toBe(false);
    });
});
