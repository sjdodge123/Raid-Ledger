import { describe, it, expect } from 'vitest';
import { foreverIdentityFromCharacter, formatForeverRuleset, foreverUpdateFields, sameForeverIdentity, usesForeverIdentity } from './forever-identity';

describe('forever-identity helpers (ROK-1721)', () => {
    it('formats the ruleset label with the region for the detail page and invite card', () => {
        expect(formatForeverRuleset('pvp', 'us')).toBe('PvP (US)');
        expect(formatForeverRuleset('roleplaying', null)).toBe('Roleplaying');
        expect(formatForeverRuleset(null, 'us')).toBeNull();
    });

    it('splits a stored "First Second" name back into its parts', () => {
        expect(foreverIdentityFromCharacter({ name: 'Ana Forever', region: 'eu', ruleset: 'pvp' }))
            .toEqual({ region: 'eu', ruleset: 'pvp', first: 'Ana', second: 'Forever' });
    });

    it('never writes Hardcore back (not accepted on update until enabled)', () => {
        expect(foreverUpdateFields({ region: 'us', ruleset: 'hardcore', first: 'Ana', second: 'Forever' }))
            .toEqual({ name: 'Ana Forever' });
    });

    it('compares identities by value, not by reference', () => {
        const a = { region: 'us', ruleset: 'pvp', first: 'Ana', second: 'Forever' } as const;
        expect(sameForeverIdentity(a, { ...a })).toBe(true);
        expect(sameForeverIdentity(a, { ...a, ruleset: 'normal' })).toBe(false);
    });

    it('a region-less (legacy) Forever character edits with the legacy fields', () => {
        const slug = 'world-of-warcraft-forever';
        expect(usesForeverIdentity(slug, null)).toBe(true);
        expect(usesForeverIdentity(slug, { region: 'eu' })).toBe(true);
        expect(usesForeverIdentity(slug, { region: null })).toBe(false);
        expect(usesForeverIdentity('world-of-warcraft', null)).toBe(false);
    });
});
