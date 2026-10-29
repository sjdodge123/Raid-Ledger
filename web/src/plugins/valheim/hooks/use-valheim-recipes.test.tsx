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
    valheimRecipePlanHandler,
    valheimRecipeStockHandler,
} from '../../../test/mocks/valheim-recipes-handlers';
import { useValheimRecipePlan, useValheimRecipeStock, valheimRecipesKeys } from './use-valheim-recipes';

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

describe('useValheimRecipePlan sources (ROK-1860 AC1)', () => {
    it('keeps the old key with no picks and appends the picks otherwise', () => {
        expect(valheimRecipesKeys.plan(1, 7, 'Bronze:1:1:0:item', false, true)).toEqual(['valheim', 'recipes', 1, 7, 'plan', 'Bronze:1:1:0:item', false, true]);
        expect(valheimRecipesKeys.plan(1, 7, 'Bronze:1:1:0:item', false, true, 'Coal:p:charcoal_kiln:0'))
            .toEqual(['valheim', 'recipes', 1, 7, 'plan', 'Bronze:1:1:0:item', false, true, 'Coal:p:charcoal_kiln:0']);
    });

    it('sends sources= only when picks exist', async () => {
        const hits: string[] = [];
        server.use(valheimRecipePlanHandler(hits));
        const none = renderHook(() => useValheimRecipePlan(7, 'Bronze:1:1:0:item', false, true, ''), { wrapper });
        await waitFor(() => expect(none.result.current.isSuccess).toBe(true));
        const picked = renderHook(() => useValheimRecipePlan(7, 'Bronze:1:1:0:item', false, true, 'Coal:p:charcoal_kiln:0'), { wrapper });
        await waitFor(() => expect(picked.result.current.isSuccess).toBe(true));
        expect(hits).toEqual([
            '?targets=Bronze%3A1%3A1%3A0%3Aitem&includePersonal=false&includeVehicles=true',
            '?targets=Bronze%3A1%3A1%3A0%3Aitem&includePersonal=false&includeVehicles=true&sources=Coal%3Ap%3Acharcoal_kiln%3A0',
        ]);
    });
});
