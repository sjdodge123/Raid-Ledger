import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ValheimContainerListResponse, ValheimMapMeta } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    BASE_A, basesFixture, chestShared, containersWithBases, materialsFixture, personalWithBases,
    valheimContainerHandler, valheimContainersHandler, valheimMaterialsHandler, VALHEIM_CONTAINERS_URL,
} from '../../../test/mocks/valheim-materials-handlers';
import { ValheimMapView } from './valheim-map-view';

vi.mock('./fog-canvas', () => ({ FogCanvas: () => <div data-testid="fog" /> }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));

const MAP_URL = 'http://localhost:3000/plugins/valheim/armory/characters/5/maps/9';
const PORTALS_URL = 'http://localhost:3000/plugins/valheim/armory/servers/:serverId/portals';
const SIZE = 64;
const WORLD = '1234567890';
/** The chest list, scanned in the map's own world. */
const listed = (): ValheimContainerListResponse => ({ ...containersWithBases(), worldUid: WORLD });
const META: ValheimMapMeta = {
    id: 9, worldUid: WORLD, grid: { textureSize: SIZE, pixelSizeMetres: 12 },
    pins: [{ type: 'Death', label: 'Grave', x: 0, z: 0, checked: false, shared: false }],
    hasSharedExplored: false, baseMap: null, capturedAt: '2026-10-19T12:00:00.000Z',
};
const HOME_CHEST = 'Wood chest 2 · Base near x 3, z 53 (Chest)';
const CART = 'Cart 1 · Away from bases (Chest)';
const FAR_CHEST = 'Wood chest 1 · Base near x 610, z −420 (Chest)';

async function gzipped(): Promise<ArrayBuffer> {
    const stream = new ReadableStream<BufferSource>({
        start(c) { c.enqueue(new Uint8Array((SIZE * SIZE) / 8)); c.close(); },
    });
    return new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

const view = (url: string, serverId?: number) =>
    renderWithProviders(<ValheimMapView characterId={5} mapId={9} serverId={serverId} />, { initialEntries: [url] });
const summary = () => screen.getByTestId('map-pin-filter');

let containerHits: string[];
let materialsHits: string[];
beforeEach(() => {
    containerHits = [];
    materialsHits = [];
    server.use(
        http.get(MAP_URL, () => HttpResponse.json(META)),
        http.get(`${MAP_URL}/fog`, async () => new HttpResponse(await gzipped())),
        http.get(PORTALS_URL, () => HttpResponse.json({ worldUid: WORLD, scannedAt: null, omitted: 0, portals: [] })),
        valheimContainersHandler(listed(), containerHits),
        valheimMaterialsHandler(materialsFixture({ bases: basesFixture, personal: personalWithBases }), materialsHits),
        valheimContainerHandler({ ...chestShared, base: BASE_A, index: 2, stacks: [{ prefab: 'Wood', quality: 1, stack: 50 }] }),
    );
});

describe('ValheimMapView Chests layer (ROK-1859 D12–D14)', () => {
    it('Chests chip on by default: one pin per listed chest (carts too), named by display name', async () => {
        view('/hub?vc=5#map', 3);
        expect(await screen.findByRole('button', { name: HOME_CHEST })).toHaveAttribute('aria-haspopup', 'dialog');
        expect(screen.getByRole('button', { name: CART })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: FAR_CHEST })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /\(Chest\)$/ })).toHaveLength(3);
        expect(containerHits).toEqual(['?includeVehicles=true']);
    });

    it('a member never gets a pin for a chest the server left out — personal totals never become pins', async () => {
        // The member's /containers read omits the private chest (server visibleSql); the personal
        // materials section is still in the totals response and must not turn into pins.
        const member: ValheimContainerListResponse = { ...listed(), containers: [{ ...chestShared, base: BASE_A, index: 2 }] };
        server.use(valheimContainersHandler(member));
        view('/hub?vc=5#map', 3);
        expect(await screen.findByRole('button', { name: HOME_CHEST })).toBeInTheDocument();
        await waitFor(() => expect(materialsHits.length).toBeGreaterThan(0));
        expect(screen.getAllByRole('button', { name: /\(Chest\)$/ }).map((b) => b.getAttribute('aria-label'))).toEqual([HOME_CHEST]);
    });

    it('clicking a chest pin opens its ChestDetail dialog, outside the map viewport; Close dismisses it', async () => {
        view('/hub?vc=5#map', 3);
        fireEvent.click(await screen.findByRole('button', { name: HOME_CHEST }));
        const dialog = await screen.findByRole('dialog', { name: 'Wood chest 2 · Base near x 3, z 53' });
        expect(within(dialog).getByTestId('valheim-chest-detail')).toBeInTheDocument();
        expect(screen.getByRole('application').contains(dialog)).toBe(false);
        expect(await within(dialog).findByRole('list', { name: 'Chest contents' })).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('D13: chests of another world draw no pins and say so', async () => {
        server.use(valheimContainersHandler({ ...containersWithBases(), worldUid: 'world-2' }));
        view('/hub?vc=5#map', 3);
        await waitFor(() => expect(summary()).toHaveTextContent('Chests are from another world'));
        expect(screen.queryByRole('button', { name: /\(Chest\)$/ })).toBeNull();
    });

    it('Chests chip off: no /containers and no /materials request, no chest pins', async () => {
        view('/hub?pins=death&vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /\(Chest\)$/ })).toBeNull();
        expect([containerHits, materialsHits]).toEqual([[], []]);
    });

    it('without a server (character page) there is no Chests layer and no request', async () => {
        view('/characters/5#map');
        expect(await screen.findByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect([containerHits, materialsHits]).toEqual([[], []]);
    });

    it('the label search narrows chest pins by display name', async () => {
        view('/hub?q=away%20from&vc=5#map', 3);
        expect(await screen.findByRole('button', { name: CART })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: HOME_CHEST })).toBeNull();
    });

    it('a failed /containers read shows the Chests danger chip + Retry, not "No pins match"', async () => {
        server.use(http.get(VALHEIM_CONTAINERS_URL, () => HttpResponse.json({ message: 'no' }, { status: 500 })));
        view('/hub?pins=chest&vc=5#map', 3);
        await waitFor(() => expect(summary()).toHaveTextContent('Chests could not be loaded'));
        expect(summary()).not.toHaveTextContent('No pins match');
        expect(within(summary()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
});
