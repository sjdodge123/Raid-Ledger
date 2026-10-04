import { describe, it, expect } from 'vitest';
import { foreverIdentityFromCharacter, formatForeverRuleset, foreverUpdateFields } from './forever-identity';

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
});
