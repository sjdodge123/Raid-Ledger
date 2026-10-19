import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type {
    ValheimCharacterDetail,
    ValheimCharacterSummary,
} from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { ValheimMapTab } from './valheim-map-tab';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 7 } }),
}));
vi.mock('./valheim-map-view', () => ({
    ValheimMapView: (p: { characterId: number; mapId: number }) => (
        <div data-testid="map-view">{`${p.characterId}:${p.mapId}`}</div>
    ),
}));

const API = 'http://localhost:3000/plugins/valheim/armory/characters';
const TS = '2026-10-19T12:00:00.000Z';

function row(
    id: number,
    name: string,
    ownerId: number | null = null,
): ValheimCharacterSummary {
    return {
        id,
        pelicanServerId: 3,
        serverName: 'Fixtureheim',
        name,
        worldName: 'Fixtureheim',
        claimedBy:
            ownerId === null ? null : { id: ownerId, username: `u${ownerId}` },
        claimSource: ownerId === null ? null : 'manual',
        capturedAt: TS,
        gameVersion: '0.220.5',
    };
}
function detail(
    r: ValheimCharacterSummary,
    mapIds: number[],
): ValheimCharacterDetail {
    return {
        ...r,
        equipment: [],
        skills: [],
        trophies: [],
        inventory: { grid: { width: 8, height: 4, extraRows: [] }, items: [] },
        maps: mapIds.map((id, i) => ({
            id,
            worldUid: `10000${id}`,
            capturedAt: `2026-10-1${i}T00:00:00.000Z`,
        })),
    };
}

function serve(
    rows: ValheimCharacterSummary[],
    maps: Record<number, number[]>,
) {
    server.use(
        http.get(API, ({ request }) =>
            new URL(request.url).searchParams.get('serverId') === '3'
                ? HttpResponse.json({ data: rows })
                : HttpResponse.json({ data: [] }),
        ),
        http.get(`${API}/:id`, ({ params }) => {
            const r = rows.find((x) => String(x.id) === params.id);
            return r
                ? HttpResponse.json(detail(r, maps[r.id] ?? []))
                : new HttpResponse(null, { status: 404 });
        }),
    );
}

function Where() {
    const l = useLocation();
    return <output data-testid="where">{`${l.search}${l.hash}`}</output>;
}

const tab = (entry = '/guilds/1#map') =>
    renderWithProviders(
        <>
            <ValheimMapTab serverId={3} />
            <Where />
        </>,
        { initialEntries: [entry] },
    );

const ROWS = [row(1, 'Ulfgar', 7), row(2, 'Bjorn'), row(3, 'Astrid')];

describe('ValheimMapTab (ROK-1837 T6)', () => {
    it("defaults to the viewer's claimed character and its only map — no world picker", async () => {
        serve(ROWS, { 1: [11] });
        tab();
        expect(await screen.findByTestId('map-view')).toHaveTextContent('1:11');
        expect(screen.getByRole('combobox', { name: 'Character' })).toHaveValue(
            '1',
        );
        expect(screen.queryByRole('combobox', { name: 'World' })).toBeNull();
    });

    it('reads ?vc&vm and shows the world picker for a multi-map character', async () => {
        serve(ROWS, { 2: [21, 22] });
        tab('/guilds/1?vc=2&vm=21#map');
        expect(await screen.findByTestId('map-view')).toHaveTextContent('2:21');
        expect(screen.getByRole('combobox', { name: 'World' })).toHaveValue(
            '21',
        );
    });

    it('picker changes round-trip into the query string and keep the #map hash', async () => {
        serve(ROWS, { 1: [11], 3: [31, 32] });
        tab();
        await screen.findByTestId('map-view');
        fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), {
            target: { value: '3' },
        });
        expect(screen.getByTestId('where')).toHaveTextContent('?vc=3#map');
        const world = await screen.findByRole('combobox', { name: 'World' });
        fireEvent.change(world, { target: { value: '31' } });
        expect(screen.getByTestId('where')).toHaveTextContent(
            '?vc=3&vm=31#map',
        );
        expect(await screen.findByTestId('map-view')).toHaveTextContent('3:31');
    });

    it('empty server: says so, no pickers', async () => {
        serve([], {});
        tab();
        expect(
            await screen.findByText(/No characters on this server yet/),
        ).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('a character without a map: says so instead of a map', async () => {
        serve([row(4, 'Solo')], { 4: [] });
        tab();
        expect(
            await screen.findByText('This character has no map uploaded yet.'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('map-view')).toBeNull();
    });

    it('a character-detail failure shows an error with Retry, not "no map"', async () => {
        serve(ROWS, { 1: [10] });
        let fail = true;
        server.use(
            http.get(`${API}/:id`, ({ params }) => {
                if (fail) return new HttpResponse(null, { status: 500 });
                const r = ROWS.find((x) => String(x.id) === params.id);
                return r
                    ? HttpResponse.json(detail(r, [10]))
                    : new HttpResponse(null, { status: 404 });
            }),
        );
        tab();
        expect(
            await screen.findByText(
                "This character's maps could not be loaded.",
            ),
        ).toBeInTheDocument();
        expect(
            screen.queryByText('This character has no map uploaded yet.'),
        ).toBeNull();
        fail = false;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByTestId('map-view')).toHaveTextContent('1:10');
    });

    it('lists every character across pages, not just the first 100', async () => {
        const many = Array.from({ length: 101 }, (_, i) =>
            row(100 + i, `C${String(i).padStart(3, '0')}`),
        );
        serve(many, {});
        server.use(
            http.get(API, ({ request }) => {
                const page = Number(
                    new URL(request.url).searchParams.get('page') ?? '1',
                );
                return HttpResponse.json({
                    data: many.slice((page - 1) * 100, page * 100),
                });
            }),
        );
        tab();
        const picker = await screen.findByLabelText('Character');
        await waitFor(() =>
            expect(picker.querySelectorAll('option')).toHaveLength(101),
        );
    });
});
