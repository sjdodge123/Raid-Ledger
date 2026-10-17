/**
 * ROK-1830: `usePluginsHydrated` gates the hub's first paint, so the one thing
 * it must never do is go back. A status request that failed settles hydration
 * as "no plugins"; mounting a second observer later re-triggers that query and
 * it is pending again, which without a latch would drop an already-rendered
 * page back to `<LoadingState/>`.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../test/mocks/server';
import { createTestQueryClient } from '../test/render-helpers';
import { usePluginStore } from '../stores/plugin-store';
import { usePluginsHydrated } from './use-plugins';

const STATUS = 'http://localhost:3000/system/status';

function wrapperFor(): ({ children }: { children: ReactNode }) => ReactNode {
    const client = createTestQueryClient();
    return function Wrapper({ children }: { children: ReactNode }): ReactNode {
        return createElement(QueryClientProvider, { client }, children);
    };
}

describe('usePluginsHydrated', () => {
    beforeEach(() => {
        usePluginStore.setState({ activeSlugs: new Set<string>(), initialized: false, settled: false });
    });

    it('stays hydrated after a failed status request when a later observer retries it', async () => {
        server.use(http.get(STATUS, () => new HttpResponse(null, { status: 500 })));

        const first = renderHook(() => usePluginsHydrated(), { wrapper: wrapperFor() });
        await waitFor(() => expect(
            first.result.current,
            'a failed status request settles hydration as "no plugins" — the page must not wait forever',
        ).toBe(true));
        first.unmount();

        // The retry this observer kicks off never answers, so without the latch
        // the hook would read pending/undefined and report "not hydrated" again.
        let releasePending = (): void => {};
        const pending = new Promise<void>((resolve) => { releasePending = (): void => { resolve(); }; });
        server.use(http.get(STATUS, async () => {
            await pending;
            return new HttpResponse(null, { status: 500 });
        }));

        try {
            const second = renderHook(() => usePluginsHydrated(), { wrapper: wrapperFor() });
            expect(
                second.result.current,
                'a remount whose status retry is still pending must not un-hydrate a page that already settled',
            ).toBe(true);
            second.unmount();
        } finally {
            releasePending();
        }
    });
});
