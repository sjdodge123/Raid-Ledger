/** ROK-1853 Codex r2 P1 — a viewer change never shows the previous viewer's rows as placeholder. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    VALHEIM_CONTAINERS_URL,
    VALHEIM_MATERIALS_URL,
    chestShared,
    containersFixture,
    materialsFixture,
} from '../../../test/mocks/valheim-materials-handlers';
import {
    useValheimContainers,
    useValheimMaterials,
} from './use-valheim-materials';

const auth = vi.hoisted(() => ({ scope: 1 as number | 'anon' }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
    useViewerCacheScope: () => auth.scope,
}));

const personal = {
    totals: [{ prefab: 'Coins', quality: 1, total: 99, chests: 1 }],
    chestCount: 1,
    omittedPrivate: 0,
};
const privateChest = { ...chestShared, privacy: 'personal' as const };

/** First request answers; every later one hangs (the "pending" window). */
function answerOnce(url: string, body: unknown) {
    let served = false;
    return http.get(url, async () => {
        if (served) await delay('infinite');
        served = true;
        return HttpResponse.json(body);
    });
}

function wrapper({ children }: { children: ReactNode }) {
    const client = createTestQueryClient();
    return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
}

beforeEach(() => {
    auth.scope = 1;
});

describe('materials hooks — placeholder data never crosses viewers', () => {
    it('totals: keeps rows across the vehicles toggle, drops them when the viewer changes', async () => {
        server.use(
            answerOnce(VALHEIM_MATERIALS_URL, materialsFixture({ personal })),
        );
        const { result, rerender } = renderHook(
            ({ vehicles }) => useValheimMaterials(7, vehicles),
            { wrapper, initialProps: { vehicles: true } },
        );
        await waitFor(() =>
            expect(result.current.data?.personal).toEqual(personal),
        );
        rerender({ vehicles: false });
        expect(result.current.isPlaceholderData).toBe(true);
        expect(result.current.data?.personal).toEqual(personal);
        auth.scope = 2;
        rerender({ vehicles: false });
        expect(result.current.data?.personal).toBeUndefined();
        expect(result.current.isPlaceholderData).toBe(false);
    });

    it('containers: drops the previous viewer’s private chest on a viewer change', async () => {
        server.use(
            answerOnce(
                VALHEIM_CONTAINERS_URL,
                containersFixture([privateChest]),
            ),
        );
        const { result, rerender } = renderHook(
            ({ vehicles }) => useValheimContainers(7, vehicles),
            { wrapper, initialProps: { vehicles: true } },
        );
        await waitFor(() =>
            expect(result.current.data?.containers).toEqual([privateChest]),
        );
        rerender({ vehicles: false });
        expect(result.current.data?.containers).toEqual([privateChest]);
        auth.scope = 2;
        rerender({ vehicles: false });
        expect(result.current.data?.containers).toBeUndefined();
    });
});
