import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type { ValheimDeathPin, ValheimMapMeta } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { valheimDeathPinsHandler } from '../../../test/mocks/valheim-deaths-handlers';
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
const deathPin = (characterName: string, characterId: number | null): ValheimDeathPin =>
    ({ x: 10, z: 10, characterId, characterName, type: 'Death' });

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

const deathsSwitch = () => screen.getByRole('switch', { name: 'Death pins only' });
const loc = () => screen.getByTestId('loc').textContent;

beforeEach(() => {
    server.use(
        http.get(MAP_URL, () => HttpResponse.json(META)),
        http.get(`${MAP_URL}/fog`, async () => new HttpResponse(await gzipped())),
    );
});

describe('ValheimMapView pin-type filter (ROK-1930 L4)', () => {
    it('a bar deep link shows only that character’s Death pins, with the switch on', async () => {
        view('/hub?pins=death&vc=5#map', 3);
        expect(await screen.findByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
        expect(deathsSwitch()).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByText("Showing this character's death pins")).toBeInTheDocument();
    });

    it('switching it off drops pins (vc + hash kept) and restores every pin', async () => {
        view('/hub?pins=death&vc=5#map', 3);
        fireEvent.click(await screen.findByRole('switch', { name: 'Death pins only' }));
        await waitFor(() => expect(loc()).toBe('?vc=5#map'));
        expect(screen.getByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect(deathsSwitch()).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByTestId('map-pin-filter')).toBeNull();
    });

    it('switching it on by hand writes ?pins=death for the shown character', async () => {
        view('/hub#map', 3);
        fireEvent.click(await screen.findByRole('switch', { name: 'Death pins only' }));
        await waitFor(() => expect(loc()).toBe('?pins=death&vc=5#map'));
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
    });

    it('Show all draws every player’s Death pins for the selected world from the server route', async () => {
        const worlds: (string | null)[] = [];
        server.use(valheimDeathPinsHandler([deathPin('Ragnhild', 11), deathPin('Unknown character', null)]));
        // Prepended after the fixture, so it sees the request first and falls through to it.
        server.use(http.get('http://localhost:3000/plugins/valheim/armory/servers/3/deaths/pins', ({ request }) => {
                worlds.push(new URL(request.url).searchParams.get('worldUid'));
                return undefined;
            }));
        view('/hub?pins=death#map', 3);
        expect(await screen.findByRole('button', { name: 'Ragnhild (Death)' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Unknown character (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Grave (Death)' })).toBeNull();
        expect(worlds).toEqual([WORLD]);
        expect(screen.getByText("Showing every player's death pins")).toBeInTheDocument();
    });

    it.each([[200], [404]])('Show all with no pins (HTTP %i) shows the empty line, never an error', async (status) => {
        server.use(valheimDeathPinsHandler([], status));
        view('/hub?pins=death#map', 3);
        expect(await screen.findByText(/No death pins on this map yet\./)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryAllByRole('button', { name: /\(Death\)|\(Bed\)/ })).toEqual([]);
    });

    it('"Show every pin" leaves the filter', async () => {
        view('/hub?pins=death&vc=5#map', 3);
        fireEvent.click(await screen.findByRole('button', { name: 'Show every pin' }));
        await waitFor(() => expect(loc()).toBe('?vc=5#map'));
        expect(screen.getByRole('button', { name: 'Home (Bed)' })).toBeInTheDocument();
    });

    it('without a server (character page) pins=death falls back to the character’s own Death pins', async () => {
        view('/c?pins=death');
        expect(await screen.findByRole('button', { name: 'Grave (Death)' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Home (Bed)' })).toBeNull();
    });
});
