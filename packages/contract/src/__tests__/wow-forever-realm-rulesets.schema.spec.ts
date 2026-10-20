import { describe, expect, it } from 'vitest';
import {
    WowForeverRealmRulesetsSchema,
    normalizeRealmName,
} from '../wow-forever-realm-rulesets.schema.js';

describe('normalizeRealmName (ROK-1739)', () => {
    it.each([
        ['Kel’Thuzad', "kel'thuzad"],
        ['Kel‘Thuzad', "kel'thuzad"],
        ['KelʼThuzad', "kel'thuzad"],
        ['Kel`Thuzad', "kel'thuzad"],
        ["Kel'Thuzad", "kel'thuzad"],
        ['  Classic  Beta   PvP ', 'classic beta pvp'],
    ])('%s → %s', (raw, key) => {
        expect(normalizeRealmName(raw)).toBe(key);
    });
});

describe('WowForeverRealmRulesetsSchema', () => {
    it('rejects a curly-apostrophe duplicate of a straight-apostrophe realm in the same region', () => {
        const result = WowForeverRealmRulesetsSchema.safeParse({
            entries: [
                { region: 'us', realmName: "Kel'Thuzad", ruleset: 'pvp' },
                { region: 'us', realmName: 'Kel’Thuzad', ruleset: 'normal' },
            ],
        });
        expect(result.success).toBe(false);
        expect(result.error?.issues[0]?.path).toEqual(['entries', 1, 'realmName']);
    });

    it('allows the same realm name in a different region', () => {
        const result = WowForeverRealmRulesetsSchema.safeParse({
            entries: [
                { region: 'us', realmName: "Kel'Thuzad", ruleset: 'pvp' },
                { region: 'eu', realmName: "Kel'Thuzad", ruleset: 'hardcore' },
            ],
        });
        expect(result.success).toBe(true);
    });
});

describe('normalizeRealmName — apostrophe look-alikes (Codex r1 P3)', () => {
    it('keys every supported look-alike like the straight apostrophe the addon sends', () => {
        const straight = normalizeRealmName("Kel'Thuzad");
        expect(straight).toBe("kel'thuzad");
        // U+00B4 is decomposed by NFKC into a space + combining accent, so the
        // look-alike replacement must run before normalisation.
        for (const variant of ['Kel´Thuzad', 'Kel’Thuzad', 'Kel‘Thuzad', 'KelʼThuzad', 'Kel`Thuzad']) {
            expect(normalizeRealmName(variant)).toBe(straight);
        }
    });
});
