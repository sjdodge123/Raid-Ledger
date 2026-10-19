import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ValheimMapMeta } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { ValheimMapView } from './valheim-map-view';

// The canvas paint is FogCanvas's own spec; here we only observe which layers it got.
vi.mock('./fog-canvas', () => ({
    FogCanvas: (p: { shared: Uint8Array | null }) => (
        <div data-testid="fog" data-shared={p.shared ? 'on' : 'off'} />
    ),
}));
vi.mock('../../../hooks/use-media-query', () => ({
    useMediaQuery: () => true,
}));

const MAP_URL =
    'http://localhost:3000/plugins/valheim/armory/characters/5/maps/9';
const SIZE = 64;
const pin = (label: string, shared: boolean) => ({
    type: 'Bed',
    label,
    x: 0,
    z: 0,
    checked: false,
    shared,
});

function meta(over: Partial<ValheimMapMeta> = {}): ValheimMapMeta {
    return {
        id: 9,
        worldUid: '1234567890',
        grid: { textureSize: SIZE, pixelSizeMetres: 12 },
        pins: [pin('Home', false), pin('Table camp', true)],
        hasSharedExplored: true,
        baseMap: {
            sha256: 'b'.repeat(64),
            width: SIZE,
            height: SIZE,
            ready: true,
        },
        capturedAt: '2026-10-19T12:00:00.000Z',
        ...over,
    };
}

async function gzipped(): Promise<ArrayBuffer> {
    const stream = new ReadableStream<BufferSource>({
        start(c) {
            c.enqueue(new Uint8Array((SIZE * SIZE) / 8));
            c.close();
        },
    });
    return new Response(
        stream.pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer();
}

interface ServeOpts {
    shared?: 'ok' | 'none' | 'fail';
    /** Hold the personal fog response until this resolves. */
    fogGate?: Promise<void>;
}

function serve(m: ValheimMapMeta, opts: ServeOpts = {}) {
    const sharedHits: string[] = [];
    server.use(
        http.get(MAP_URL, () => HttpResponse.json(m)),
        http.get(
            `${MAP_URL}/base-map`,
            () =>
                new HttpResponse(new Blob(['png']), {
                    headers: { 'Content-Type': 'image/png' },
                }),
        ),
        http.get(`${MAP_URL}/fog`, async ({ request }) => {
            const layer = new URL(request.url).searchParams.get('layer') ?? '';
            if (layer === 'shared') {
                sharedHits.push(layer);
                if (opts.shared === 'none')
                    return HttpResponse.json(
                        { code: 'no_shared_layer' },
                        { status: 404 },
                    );
                if (opts.shared === 'fail')
                    return HttpResponse.json(
                        { message: 'boom' },
                        { status: 500 },
                    );
            } else if (opts.fogGate) await opts.fogGate;
            return new HttpResponse(await gzipped());
        }),
    );
    return sharedHits;
}

beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: vi.fn(() => 'blob:base'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: vi.fn(),
    });
});

const view = () =>
    renderWithProviders(<ValheimMapView characterId={5} mapId={9} />);

describe('ValheimMapView (ROK-1837 T6)', () => {
    it('shows a loading frame, then the map with personal pins only', async () => {
        serve(meta());
        view();
        expect(screen.getByLabelText('Loading map')).toHaveAttribute(
            'aria-busy',
            'true',
        );
        expect(
            await screen.findByRole('application', { name: 'Valheim map' }),
        ).toBeInTheDocument();
        expect(await screen.findByTestId('fog')).toHaveAttribute(
            'data-shared',
            'off',
        );
        expect(
            screen.getByRole('button', { name: 'Home (Bed)' }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Table camp (Bed)' }),
        ).toBeNull();
        await waitFor(() =>
            expect(document.querySelector('img')).toHaveAttribute(
                'src',
                'blob:base',
            ),
        );
    });

    it('the cartography switch fetches the shared fog and shows shared pins', async () => {
        const sharedHits = serve(meta());
        view();
        await screen.findByTestId('fog');
        expect(sharedHits).toHaveLength(0);
        fireEvent.click(
            screen.getByRole('switch', { name: 'Show cartography table' }),
        );
        await waitFor(() =>
            expect(screen.getByTestId('fog')).toHaveAttribute(
                'data-shared',
                'on',
            ),
        );
        expect(sharedHits).toEqual(['shared']);
        expect(
            screen.getByRole('button', { name: 'Table camp (Bed)' }),
        ).toBeInTheDocument();
    });

    it('the Pin labels switch opens every label', async () => {
        serve(meta());
        view();
        await screen.findByTestId('fog');
        expect(screen.getByText('Home')).toHaveAttribute('data-open', 'false');
        fireEvent.click(screen.getByRole('switch', { name: 'Pin labels' }));
        expect(screen.getByText('Home')).toHaveAttribute('data-open', 'true');
    });
});

describe('ValheimMapView states (ROK-1837 T6)', () => {
    it('keeps the base map covered until the personal fog has decoded (AC1)', async () => {
        let release: () => void = () => undefined;
        const fogGate = new Promise<void>((r) => {
            release = r;
        });
        serve(meta(), { fogGate });
        view();
        await screen.findByRole('application', { name: 'Valheim map' });
        await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
        await act(async () => {
            await new Promise((r) => setTimeout(r, 0));
        });
        expect(document.querySelector('img')).toBeNull();
        expect(screen.getByTestId('map-fog-pending')).toHaveClass(
            'bg-backdrop',
        );
        release();
        await screen.findByTestId('fog');
        await waitFor(() =>
            expect(document.querySelector('img')).not.toBeNull(),
        );
        expect(screen.queryByTestId('map-fog-pending')).toBeNull();
    });

    it('a shared-layer failure (not no_shared_layer) shows an inline error and turns the switch off', async () => {
        serve(meta(), { shared: 'fail' });
        view();
        await screen.findByTestId('fog');
        fireEvent.click(
            screen.getByRole('switch', { name: 'Show cartography table' }),
        );
        expect(
            await screen.findByText('Cartography layer could not be loaded'),
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(
                screen.getByRole('switch', { name: 'Show cartography table' }),
            ).toHaveAttribute('aria-checked', 'false'),
        );
        expect(screen.getByTestId('fog')).toHaveAttribute('data-shared', 'off');
    });

    it('base map not ready: warning chip, no image request', async () => {
        serve(
            meta({
                baseMap: {
                    sha256: 'b'.repeat(64),
                    width: SIZE,
                    height: SIZE,
                    ready: false,
                },
            }),
        );
        view();
        expect(
            await screen.findByText('Base map not uploaded yet'),
        ).toBeInTheDocument();
        await screen.findByTestId('fog');
        expect(document.querySelector('img')).toBeNull();
    });

    it('hasSharedExplored=false: switch disabled with the hint', async () => {
        serve(meta({ hasSharedExplored: false }));
        view();
        const sw = await screen.findByRole('switch', {
            name: 'Show cartography table',
        });
        expect(sw).toBeDisabled();
        expect(
            screen.getByText('No cartography table data for this world yet.'),
        ).toBeInTheDocument();
    });

    it('a no_shared_layer 404 disables the switch instead of erroring', async () => {
        serve(meta(), { shared: 'none' });
        view();
        await screen.findByTestId('fog');
        fireEvent.click(
            screen.getByRole('switch', { name: 'Show cartography table' }),
        );
        await waitFor(() =>
            expect(
                screen.getByRole('switch', { name: 'Show cartography table' }),
            ).toBeDisabled(),
        );
        expect(screen.getByTestId('fog')).toHaveAttribute('data-shared', 'off');
    });

    it('a meta failure shows an error with Retry', async () => {
        server.use(
            http.get(MAP_URL, () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 }),
            ),
        );
        view();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The map could not be loaded.',
        );
        expect(
            screen.getByRole('button', { name: 'Retry' }),
        ).toBeInTheDocument();
    });
});
