/**
 * ROK-2215 — the event-plan pre-fill host API: core asks the ACTIVE plugin that
 * registered a provider to resolve a plan link; with none active, nothing resolves.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { registerPlugin, clearRegistry } from './plugin-registry';
import { useEventPlanPrefill, type EventPlanPrefillRequest } from './event-plan-prefill';
import { usePluginStore } from '../stores/plugin-store';

const BADGE = { icon: '/x.png', color: 'blue', label: 'X' };
const REQ: EventPlanPrefillRequest = { gameSlug: 'game-a', guildId: 7, instanceIds: [4], inviteCharacterIds: ['a', 'b'] };
const seen: EventPlanPrefillRequest[] = [];

beforeEach(() => {
    clearRegistry();
    seen.length = 0;
    usePluginStore.setState({ activeSlugs: new Set(['core', 'dungeons']), initialized: true, settled: true });
});

function registerProvider(): void {
    registerPlugin('dungeons', BADGE).registerEventPlanPrefill((req) => {
        seen.push(req);
        return { initialInstances: req.instanceIds.map((id) => ({ id })), inviteNames: { names: ['Aelin'], unresolved: req.inviteCharacterIds.length - 1 }, isLoading: false };
    });
}

describe('useEventPlanPrefill (ROK-2215)', () => {
    it('an active provider resolves the plan, and the invites pass through', () => {
        registerProvider();
        const { result } = renderHook(() => useEventPlanPrefill(REQ));
        expect(result.current.initialInstances).toEqual([{ id: 4 }]);
        expect(result.current.inviteCharacterIds).toEqual(['a', 'b']);
        expect(result.current.inviteNames).toEqual({ names: ['Aelin'], unresolved: 1 });
    });

    it('an inactive provider is asked nothing and the plan is dropped', () => {
        registerProvider();
        usePluginStore.setState({ activeSlugs: new Set(['core']) });
        const { result } = renderHook(() => useEventPlanPrefill(REQ));
        expect(seen.every((r) => r.instanceIds.length === 0 && r.inviteCharacterIds.length === 0), 'no ids reach an inactive plugin').toBe(true);
        expect(result.current).toEqual({ initialInstances: [], inviteCharacterIds: [], inviteNames: { names: [], unresolved: 0 }, isLoading: false });
    });

    it('with no provider registered the plan is dropped', () => {
        const { result } = renderHook(() => useEventPlanPrefill(REQ));
        expect(result.current.initialInstances).toEqual([]);
        expect(result.current.inviteCharacterIds).toEqual([]);
        expect(result.current.isLoading).toBe(false);
    });
});
