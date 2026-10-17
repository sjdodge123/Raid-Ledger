import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { clearRegistry, registerPlugin, getCharacterIdentityRegistration } from '../plugin-registry';
import { useCharacterIdentity, useCharacterLocationLabel } from '../character-identity';
import { usePluginStore } from '../../stores/plugin-store';
import { foreverIdentityProvider } from './forever-identity-provider';
import { ForeverIdentityFields } from './components/forever-identity-fields';
import { FOREVER_NAME_REQUIRED, WOW_FOREVER_GAME_SLUG } from './lib/forever-identity';

describe('foreverIdentityProvider (ROK-1733)', () => {
    beforeEach(() => {
        clearRegistry();
        registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerCharacterIdentity(foreverIdentityProvider);
        usePluginStore.setState({ activeSlugs: new Set(['blizzard']), initialized: true });
    });

    it('is registered for the WoW: Forever slug only, owned by the blizzard plugin', () => {
        expect(foreverIdentityProvider.gameSlugs).toEqual([WOW_FOREVER_GAME_SLUG]);
        expect(getCharacterIdentityRegistration(WOW_FOREVER_GAME_SLUG)?.pluginSlug).toBe('blizzard');
        expect(renderHook(() => useCharacterIdentity('world-of-warcraft-classic')).result.current).toBeNull();
    });

    it('applies to new and region-bearing rows, not a legacy region-less row', () => {
        expect(renderHook(() => useCharacterIdentity(WOW_FOREVER_GAME_SLUG)).result.current).toBe(foreverIdentityProvider);
        expect(renderHook(() => useCharacterIdentity(WOW_FOREVER_GAME_SLUG, { region: 'eu' })).result.current).toBe(foreverIdentityProvider);
        expect(renderHook(() => useCharacterIdentity(WOW_FOREVER_GAME_SLUG, { region: null })).result.current).toBeNull();
    });

    it('carries the Forever fields component, hides the realm and labels the location', () => {
        expect(foreverIdentityProvider.Fields).toBe(ForeverIdentityFields);
        expect(foreverIdentityProvider.hidesRealm).toBe(true);
        const label = renderHook(() => useCharacterLocationLabel()).result.current;
        expect(label({ ruleset: 'pvp', region: 'us' })).toBe('PvP (US)');
        expect(label({ ruleset: null, region: 'us' })).toBeNull();
    });

    it('validates through the Forever rules', () => {
        expect(foreverIdentityProvider.validate(foreverIdentityProvider.empty())).toEqual({ name: FOREVER_NAME_REQUIRED });
        expect(foreverIdentityProvider.validate({ region: 'us', ruleset: 'pvp', first: 'Ana', second: 'Forever' })).toBeNull();
    });
});
