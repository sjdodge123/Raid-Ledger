/** ROK-1899 — the Planner crafting window's stock query: same scope switches as `/plan`, viewer-scoped placeholder. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    STOCK,
    VALHEIM_RECIPE_STOCK_URL,
    recipeStockFixture,
    valheimRecipeStockHandler,
} from '../../../test/mocks/valheim-recipes-handlers';
import { useValheimRecipeStock, valheimRecipesKeys } from './use-valheim-recipes';

const auth = vi.hoisted(() => ({ scope: 1 as number | 'anon' }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
    useViewerCacheScope: () => auth.scope,
}));

function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
    auth.scope = 1;
});

describe('useValheimRecipeStock', () => {
    it('keys on viewer, server, personal and vehicles', () => {
        expect(valheimRecipesKeys.stock(1, 7, true, false)).toEqual(['valheim', 'recipes', 1, 7, 'stock', true, false]);
    });

    it('sends both switches and returns the totals', async () => {
        const hits: string[] = [];
        server.use(valheimRecipeStockHandler(hits));
        const { result } = renderHook(() => useValheimRecipeStock(7, true, false), { wrapper });
        await waitFor(() => expect(result.current.data?.totals).toEqual(STOCK));
        expect(hits).toEqual(['?includePersonal=true&includeVehicles=false']);
        expect(result.current.data?.stock).toBe('scan');
    });

    it('keeps totals across a switch, drops them when the viewer changes', async () => {
        let served = false;
        server.use(http.get(VALHEIM_RECIPE_STOCK_URL, async () => {
            if (served) await delay('infinite');
            served = true;
            return HttpResponse.json(recipeStockFixture());
        }));
        const { result, rerender } = renderHook(({ vehicles }) => useValheimRecipeStock(7, false, vehicles), {
            wrapper, initialProps: { vehicles: true },
        });
        await waitFor(() => expect(result.current.data?.totals).toEqual(STOCK));
        rerender({ vehicles: false });
        expect(result.current.isPlaceholderData).toBe(true);
        auth.scope = 2;
        rerender({ vehicles: false });
        expect(result.current.data).toBeUndefined();
    });
});
