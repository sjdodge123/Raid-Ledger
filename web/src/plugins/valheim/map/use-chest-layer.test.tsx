/** ROK-1859 — the Chests layer's pending/error/Retry cover the /materials read (base names) too. */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    basesFixture, containersWithBases, materialsFixture, personalWithBases,
    valheimContainersHandler, valheimMaterialsHandler, VALHEIM_MATERIALS_URL,
} from '../../../test/mocks/valheim-materials-handlers';
import { DEFAULT_PIN_FILTER } from './pin-filter';
import { useChestLayer, type ChestLayer } from './use-chest-layer';

const WORLD = '1234567890';
function renderLayer(): { now: () => ChestLayer } {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useChestLayer(DEFAULT_PIN_FILTER, 3, WORLD), { wrapper });
    return { now: () => result.current };
}

let materialsHits: string[];
beforeEach(() => {
    materialsHits = [];
    server.use(valheimContainersHandler({ ...containersWithBases(), worldUid: WORLD }));
});

describe('useChestLayer — the /materials read gates the layer', () => {
    it('while /materials is still pending the layer is pending, even with /containers loaded', async () => {
        server.use(http.get(VALHEIM_MATERIALS_URL, async () => { await delay('infinite'); return HttpResponse.json({}); }));
        const { now } = renderLayer();
        await waitFor(() => expect(now().chests).toHaveLength(3));
        expect(now().summary.chestsPending).toBe(true);
        expect(now().summary.chestsError).toBe(false);
    });

    it('a failed /materials read is the layer error, and Retry refetches /materials', async () => {
        server.use(http.get(VALHEIM_MATERIALS_URL, () => HttpResponse.json({ message: 'no' }, { status: 500 })));
        const { now } = renderLayer();
        await waitFor(() => expect(now().chests).toHaveLength(3));
        await waitFor(() => expect(now().summary.chestsError).toBe(true));
        server.use(valheimMaterialsHandler(materialsFixture({ bases: basesFixture, personal: personalWithBases }), materialsHits));
        now().summary.onRetryChests();
        await waitFor(() => expect(now().summary.chestsError).toBe(false));
        expect(materialsHits).toHaveLength(1);
        expect(now().bases).toHaveLength(basesFixture.length);
    });
});
