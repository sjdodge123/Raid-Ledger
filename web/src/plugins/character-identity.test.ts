import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { clearRegistry, getCharacterIdentityRegistration, getCharacterIdentityRegistrations, registerPlugin } from './plugin-registry';
import { useCharacterIdentity, useCharacterLocationLabel, type CharacterIdentityProvider } from './character-identity';
import { usePluginStore } from '../stores/plugin-store';

const BADGE = { icon: '/x.png', color: 'blue', label: 'Test' };

function stubProvider(overrides: Partial<CharacterIdentityProvider<string>> = {}): CharacterIdentityProvider<string> {
    return {
        gameSlugs: ['game-a'],
        appliesTo: (editing) => !editing || !!editing.region,
        empty: () => '',
        fromCharacter: (c) => c?.name ?? '',
        same: (a, b) => a === b,
        validate: () => null,
        createFields: (v) => ({ name: v }),
        updateFields: (v) => ({ name: v }),
        hidesRealm: true,
        Fields: () => null,
        formatLocation: (c) => (c.ruleset ? `label:${c.ruleset}` : null),
        ...overrides,
    };
}

function activate(...slugs: string[]): void {
    usePluginStore.setState({ activeSlugs: new Set(slugs), initialized: true });
}

describe('plugin-registry — character identity (ROK-1733)', () => {
    beforeEach(() => { clearRegistry(); activate(); });

    it('registers one entry per game slug, owned by the registering plugin', () => {
        const provider = stubProvider({ gameSlugs: ['game-a', 'game-b'] });
        registerPlugin('plug', BADGE).registerCharacterIdentity(provider);
        expect(getCharacterIdentityRegistration('game-a')).toEqual({ pluginSlug: 'plug', provider });
        expect(getCharacterIdentityRegistration('game-b')?.provider).toBe(provider);
        expect(getCharacterIdentityRegistration('game-c')).toBeUndefined();
        expect(getCharacterIdentityRegistrations()).toHaveLength(2);
    });

    it('clearRegistry empties the identity registry', () => {
        registerPlugin('plug', BADGE).registerCharacterIdentity(stubProvider());
        clearRegistry();
        expect(getCharacterIdentityRegistration('game-a')).toBeUndefined();
        expect(getCharacterIdentityRegistrations()).toEqual([]);
    });
});

describe('useCharacterIdentity (ROK-1733)', () => {
    beforeEach(() => { clearRegistry(); activate(); });

    it('returns the provider only while its plugin is active', () => {
        const provider = stubProvider();
        registerPlugin('plug', BADGE).registerCharacterIdentity(provider);
        const { result, rerender } = renderHook(() => useCharacterIdentity('game-a'));
        expect(result.current, 'inactive plugin must not supply an identity provider').toBeNull();
        activate('plug');
        rerender();
        expect(result.current).toBe(provider);
    });

    it('returns null for an unclaimed or missing game slug', () => {
        registerPlugin('plug', BADGE).registerCharacterIdentity(stubProvider());
        activate('plug');
        expect(renderHook(() => useCharacterIdentity('game-z')).result.current).toBeNull();
        expect(renderHook(() => useCharacterIdentity(null)).result.current).toBeNull();
        expect(renderHook(() => useCharacterIdentity(undefined)).result.current).toBeNull();
    });

    it('returns null when the provider does not apply to the row being edited', () => {
        const provider = stubProvider();
        registerPlugin('plug', BADGE).registerCharacterIdentity(provider);
        activate('plug');
        expect(renderHook(() => useCharacterIdentity('game-a', { region: null })).result.current).toBeNull();
        expect(renderHook(() => useCharacterIdentity('game-a', { region: 'us' })).result.current).toBe(provider);
        expect(renderHook(() => useCharacterIdentity('game-a', null)).result.current).toBe(provider);
    });
});

describe('useCharacterLocationLabel (ROK-1733)', () => {
    beforeEach(() => { clearRegistry(); activate(); });

    it('returns the first non-null label from an active provider', () => {
        registerPlugin('silent', BADGE).registerCharacterIdentity(stubProvider({ gameSlugs: ['game-s'], formatLocation: () => null }));
        registerPlugin('plug', BADGE).registerCharacterIdentity(stubProvider());
        activate('silent', 'plug');
        const { result } = renderHook(() => useCharacterLocationLabel());
        expect(result.current({ ruleset: 'pvp', region: 'us' })).toBe('label:pvp');
        expect(result.current({ ruleset: null, region: 'us' })).toBeNull();
    });

    it('ignores providers whose plugin is inactive', () => {
        registerPlugin('plug', BADGE).registerCharacterIdentity(stubProvider());
        const { result, rerender } = renderHook(() => useCharacterLocationLabel());
        expect(result.current({ ruleset: 'pvp' }), 'inactive plugin must not label a character').toBeNull();
        activate('plug');
        rerender();
        expect(result.current({ ruleset: 'pvp' })).toBe('label:pvp');
    });
});
