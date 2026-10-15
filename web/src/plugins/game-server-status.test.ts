import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePluginStore } from '../stores/plugin-store';
import { clearRegistry, registerPlugin } from './plugin-registry';
import { getGameServerProviderSlugs, useGameServerProvidersActive } from './game-server-status';

const BADGE = { icon: '/x.svg', color: '#000', label: 'X' };

describe('game-server status host API (ROK-1776)', () => {
    beforeEach(() => {
        clearRegistry();
        usePluginStore.setState({ activeSlugs: new Set<string>() });
    });

    it('records the slug of a plugin that declares a provider', () => {
        registerPlugin('test-gs', BADGE).registerGameServerProvider();
        registerPlugin('other', BADGE);
        expect(getGameServerProviderSlugs()).toEqual(['test-gs']);
    });

    it('is false while the declaring plugin is inactive', () => {
        registerPlugin('test-gs', BADGE).registerGameServerProvider();
        usePluginStore.setState({ activeSlugs: new Set(['other']) });
        const { result } = renderHook(() => useGameServerProvidersActive());
        expect(result.current).toBe(false);
    });

    it('is false when an active plugin never declared a provider', () => {
        registerPlugin('other', BADGE);
        usePluginStore.setState({ activeSlugs: new Set(['other']) });
        const { result } = renderHook(() => useGameServerProvidersActive());
        expect(result.current).toBe(false);
    });

    it('turns true when the declaring plugin becomes active', () => {
        registerPlugin('test-gs', BADGE).registerGameServerProvider();
        const { result } = renderHook(() => useGameServerProvidersActive());
        expect(result.current).toBe(false);
        act(() => usePluginStore.setState({ activeSlugs: new Set(['test-gs']) }));
        expect(result.current).toBe(true);
    });

    it('clearRegistry resets the declared providers', () => {
        registerPlugin('test-gs', BADGE).registerGameServerProvider();
        clearRegistry();
        expect(getGameServerProviderSlugs()).toEqual([]);
    });
});
