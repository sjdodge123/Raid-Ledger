import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type { ValheimMapMeta, ValheimServerPin, ValheimServerPortal } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { valheimServerPinsHandler } from '../../../test/mocks/valheim-deaths-handlers';
import { ValheimMapView } from './valheim-map-view';

vi.mock('./fog-canvas', () => ({ FogCanvas: () => <div data-testid="fog" /> }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));

const MAP_URL = 'http://localhost:3000/plugins/valheim/armory/characters/5/maps/9';
const SIZE = 64;
const WORLD = '1234567890';
const pin = (type: string, label: string) => ({ type, label, x: 0, z: 0, checked: false, shared: false });
const META: ValheimMapMeta = {
    id: 9, worldUid: WORLD, grid: { textureSize: SIZE, pixelSizeMetres: 12 },
    pins: [pin('Bed', 'Home'), pin('Death', 'Grave')], hasSharedExplored: false, baseMap: null,
    capturedAt: '2026-10-19T12:00:00.000Z',
};
const PORTALS_URL = 'http://localhost:3000/plugins/valheim/armory/servers/:serverId/portals';
const portal = (tag: string, x: number): ValheimServerPortal => ({ prefab: 'portal_wood', x, y: null, z: 0, tag });
const PORTALS = [portal('swamp', 30), portal('', 60)];
function portalsHandler(portals: ValheimServerPortal[], opts: { status?: number; seen?: URLSearchParams[]; omitted?: number } = {}) {
    return http.get(PORTALS_URL, ({ request }) => {
        opts.seen?.push(new URL(request.url).searchParams);
        if (opts.status !== undefined) return HttpResponse.json({ message: 'no' }, { status: opts.status });
        return HttpResponse.json({ worldUid: WORLD, scannedAt: '2026-10-23T10:00:00.000Z', omitted: opts.omitted ?? 0, portals });
    });
}
const serverPin = (type: string, label: string, characterName: string, characterId: number | null): ValheimServerPin =>
    ({ x: 10, z: 10, type, label, checked: false, characterId, characterName });

async function gzipped(): Promise<ArrayBuffer> {
    const stream = new ReadableStream<BufferSource>({
        start(c) { c.enqueue(new Uint8Array((SIZE * SIZE) / 8)); c.close(); },
    });
    return new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

function LocationProbe() {
    const loc = useLocation();
    return <output data-testid="loc">{`${loc.search}${loc.hash}`}</output>;
}

function view(url: string, serverId?: number) {
    return renderWithProviders(
        <><ValheimMapView characterId={5} mapId={9} serverId={serverId} /><LocationProbe /></>,
        { initialEntries: [url] },
    );
}

const loc = () => screen.getByTestId('loc').textContent;
const openFilters = async () => fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
const summary = () => screen.getByTestId('map-pin-filter');

beforeEach(() => {
    server.use(
        http.get(MAP_URL, () => HttpResponse.json(META)),
        http.get(`${MAP_URL}/fog`, async () => new HttpResponse(await gzipped())),
        portalsHandler([]),
    );
});

describe('ValheimMapView pin filter panel (ROK-1943)', () => {
    it('a Deaths bar deep link shows only that character’s Death pins, Death chip on', async () => {
        view('/hub?pins=death&vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
        await openFilters();
        expect(screen.getByTestId('map-pin-type-death')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('map-pin-type-bed')).toHaveAttribute('aria-pressed', 'false');
    });

    it('the Death chip off (last chip) drops pins, keeps vc + hash and restores every pin', async () => {
        view('/hub?pins=death&vc=5#map', 3);
        await openFilters();
        fireEvent.click(screen.getByTestId('map-pin-type-death'));
        await waitFor(() => expect(loc()).toBe('?vc=5#map'));
        expect(screen.getByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
    });

    it('a chip on from every type writes pins=<group> and draws only that type', async () => {
        view('/hub?vc=5#map', 3);
        await openFilters();
        fireEvent.click(screen.getByTestId('map-pin-type-bed'));
        await waitFor(() => expect(loc()).toBe('?vc=5&pins=bed#map'));
        expect(screen.getByTestId('map-pin-type-bed')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Grave (Death)' })).toBeNull();
    });

    it('a label search writes q and narrows the pins to matching labels', async () => {
        view('/hub?vc=5#map', 3);
        await openFilters();
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search pin labels' }), { target: { value: 'grav' } });
        await waitFor(() => expect(loc()).toBe('?vc=5&q=grav#map'));
        expect(screen.getByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
    });

    it('no "Death pins only" switch is left in the Layers control (D11)', async () => {
        view('/hub#map', 3);
        await screen.findByRole('button', { name: 'Grave (Death)' });
        expect(screen.queryByRole('switch', { name: 'Death pins only' })).toBeNull();
        expect(screen.getByRole('switch', { name: 'Show cartography table' })).toBeInTheDocument();
    });
});

describe('ValheimMapView players pin layer (ROK-1943)', () => {
    it('legacy ?pins=death draws every player’s Death pins from /servers/:id/pins, labelled "<label> · <character>"', async () => {
        const seen: URLSearchParams[] = [];
        server.use(valheimServerPinsHandler(
            [serverPin('Death', '', 'Ragnhild', 11), serverPin('Death', '', 'Unknown character', null)], { seen },
        ));
        view('/hub?pins=death#map', 3);
        expect(await screen.findByRole('button', { name: 'Death · Ragnhild (Death)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Death · Unknown character (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Grave (Death)' })).toBeNull();
        expect(seen.map((q) => [q.get('worldUid'), q.get('players'), q.get('types')])).toEqual([[WORLD, null, 'Death']]);
    });

    it('Whose pins = Everyone writes players=all and draws other players’ pins of every type', async () => {
        const seen: URLSearchParams[] = [];
        server.use(valheimServerPinsHandler([serverPin('Bed', 'Base', 'Ragnhild', 11)], { seen }));
        view('/hub?vc=5#map', 3);
        await openFilters();
        fireEvent.click(screen.getByRole('radio', { name: 'Everyone' }));
        await waitFor(() => expect(loc()).toContain('players=all'));
        expect(await screen.findByRole('button', { name: 'Base · Ragnhild (Bed)' })).toBeInTheDocument();
        expect(seen.map((q) => [q.get('players'), q.get('types')])).toEqual([[null, null]]);
        expect(screen.getByText(/Cartography-table copies are left out/)).toBeInTheDocument();
    });

    it('a visitor (hub 404) gets the member hint, an empty layer and no error chip', async () => {
        server.use(valheimServerPinsHandler([], { status: 404 }));
        view('/hub?pins=death&players=all&vc=5#map', 3);
        await waitFor(() => expect(summary()).toHaveTextContent("Other players' pins are visible to hub members."));
        expect(screen.queryByText('Pins could not be loaded')).toBeNull();
        expect(screen.queryAllByRole('button', { name: /\(Death\)|\(Bed\)/ })).toEqual([]);
    });

    it('filters that hide every pin say so, and "Clear filters" brings every pin back', async () => {
        server.use(valheimServerPinsHandler([]));
        view('/hub?pins=death&players=all&vc=5#map', 3);
        await waitFor(() => expect(summary()).toHaveTextContent('No pins match these filters.'));
        expect(screen.getByRole('application')).toBeInTheDocument();
        fireEvent.click(within(summary()).getByRole('button', { name: 'Clear filters' }));
        await waitFor(() => expect(loc()).toBe('?vc=5#map'));
        expect(await screen.findByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
    });

    it('a failed layer shows the danger chip with Retry, which asks again', async () => {
        const seen: URLSearchParams[] = [];
        server.use(valheimServerPinsHandler([], { status: 500, seen }));
        view('/hub?players=all&vc=5#map', 3);
        expect(await screen.findByText('Pins could not be loaded')).toBeInTheDocument();
        fireEvent.click(within(summary()).getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(seen).toHaveLength(2));
    });

    it('a truncated layer appends the cap line', async () => {
        server.use(valheimServerPinsHandler([serverPin('Bed', 'Base', 'Ragnhild', 11)], { truncated: true }));
        view('/hub?players=all&vc=5#map', 3);
        await waitFor(() => expect(summary()).toHaveTextContent('Showing the first 2,000 pins — narrow the filters.'));
    });

    it('without a server (character page) pins=death falls back to the character’s own Death pins, no Whose pins', async () => {
        view('/c?pins=death');
        expect(await screen.findByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
        await openFilters();
        expect(screen.queryByRole('radio', { name: 'Everyone' })).toBeNull();
        expect(screen.getByRole('searchbox', { name: 'Search pin labels' })).toBeInTheDocument();
    });
});

describe('ValheimMapView scanned portals (ROK-1946)', () => {
    it('draws the server\u2019s portals in "This character" scope beside the character\u2019s own pins', async () => {
        const seen: URLSearchParams[] = [];
        server.use(portalsHandler(PORTALS, { seen }));
        view('/hub?vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'swamp (Scanned portal)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unnamed portal (Scanned portal)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
        expect(seen.map((q) => q.get('worldUid'))).toEqual([WORLD]);
    });

    it('another chip alone hides them', async () => {
        server.use(portalsHandler(PORTALS));
        view('/hub?pins=bed&vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /\(Scanned portal\)/ })).toBeNull();
    });

    it('a label search narrows them', async () => {
        server.use(portalsHandler(PORTALS));
        view('/hub?q=swa&vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'swamp (Scanned portal)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Unnamed portal (Scanned portal)' })).toBeNull();
    });

    it('a hub 404 draws no portals and no error, and the map still renders', async () => {
        server.use(portalsHandler([], { status: 404 }));
        view('/hub?vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
        expect(screen.getByRole('application')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /\(Scanned portal\)/ })).toBeNull();
        expect(screen.queryByText('Portals could not be loaded')).toBeNull();
    });

    it('a failed portal read shows its danger chip; omitted portals are counted', async () => {
        server.use(portalsHandler([], { status: 500 }));
        view('/hub?vc=5#map', 3);
        expect(await screen.findByText('Portals could not be loaded')).toBeInTheDocument();
        server.use(portalsHandler(PORTALS, { omitted: 2 }));
        fireEvent.click(within(summary()).getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(summary()).toHaveTextContent('Some portals were not uploaded (2).'));
    });

    it('D13: Scanned portals only in Everyone scope sends no /pins request', async () => {
        const pinsSeen: URLSearchParams[] = [];
        server.use(valheimServerPinsHandler([serverPin('Bed', 'Base', 'Ragnhild', 11)], { seen: pinsSeen }), portalsHandler(PORTALS));
        view('/hub?pins=scanned-portal&players=all&vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'swamp (Scanned portal)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Ragnhild/ })).toBeNull();
        expect(summary()).not.toHaveTextContent('Loading pins…');
        expect(pinsSeen).toEqual([]);
    });

    it('without a server (character page) there is no portal layer', async () => {
        const seen: URLSearchParams[] = [];
        server.use(portalsHandler(PORTALS, { seen }));
        view('/c#map');
        expect(await screen.findByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /\(Scanned portal\)/ })).toBeNull();
        expect(seen).toEqual([]);
    });
});
