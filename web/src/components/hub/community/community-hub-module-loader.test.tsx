/**
 * ROK-1870 Codex r3 — a failed community-module chunk load must not hold the
 * hub page's skeleton forever: a stale deploy chunk reloads once (the
 * `lazyWithRetry` idiom), anything else surfaces an error with a retry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ fail: null as Error | null }));

vi.mock('./community-hub-module', () => ({
    get communityHubModule(): { kind: string } {
        if (state.fail) throw state.fail;
        return { kind: 'game_community' };
    },
}));

type HubModuleApi = typeof import('../../../plugins/hub-module');
const KIND = 'game_community';
const originalLocation = window.location;
let reload: ReturnType<typeof vi.fn>;

async function freshApi(): Promise<HubModuleApi> {
    vi.resetModules();
    return import('../../../plugins/hub-module');
}

function renderLoader(api: HubModuleApi) {
    return renderHook(() => ({
        pending: api.useHubModulePending(KIND),
        mod: api.useHubModule(KIND),
    }));
}

beforeEach(() => {
    state.fail = null;
    sessionStorage.clear();
    reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...originalLocation, reload } });
});

afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
});

describe('community hub module loader failures', () => {
    it('a failed load ends the loading skeleton', async () => {
        state.fail = new Error('boom');
        const { result } = renderLoader(await freshApi());
        await waitFor(() => expect(result.current.pending).toBe(false));
        expect(result.current.mod).toBeUndefined();
    });

    it('surfaces the error and Retry loads the module', async () => {
        state.fail = new Error('boom');
        const api = await freshApi();
        const { result } = renderHook(() => ({ error: api.useHubModuleLoadError(KIND), mod: api.useHubModule(KIND) }));
        await waitFor(() => expect(result.current.error?.message).toBe('boom'));
        state.fail = null;
        act(() => api.retryHubModuleLoad());
        await waitFor(() => expect(result.current.mod?.kind).toBe(KIND));
        expect(result.current.error).toBeUndefined();
    });

    it('a stale deploy chunk reloads the page once instead of erroring', async () => {
        state.fail = new Error('Failed to fetch dynamically imported module: /assets/community-hub-module.js');
        const { result } = renderLoader(await freshApi());
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(result.current.pending).toBe(true);
    });
});
