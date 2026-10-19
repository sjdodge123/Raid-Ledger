/** ROK-1836 — the hub Characters tab: rows, owner chips, empty + error states, row navigation. */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_CHARACTERS_URL,
    valheimCharacterAssigned,
    valheimCharacterClaimed,
    valheimCharactersHandler,
    valheimCharacterUnclaimed,
} from '../../../test/mocks/valheim-armory-handlers';
import { ValheimCharactersTab } from './valheim-characters-tab';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

function Landed() {
    const loc = useLocation();
    return (
        <p>
            landed {loc.pathname} from {JSON.stringify(loc.state)}
        </p>
    );
}

function renderTab() {
    return renderWithProviders(
        <Routes>
            <Route
                path="/guilds/:id"
                element={<ValheimCharactersTab serverId={7} />}
            />
            <Route path="/valheim/characters/:id" element={<Landed />} />
        </Routes>,
        { initialEntries: ['/guilds/4'] },
    );
}

describe('ValheimCharactersTab', () => {
    it('lists the server characters with owner / Unclaimed chips and the count', async () => {
        let asked = '';
        server.use(
            http.get(VALHEIM_CHARACTERS_URL, ({ request }) => {
                asked = new URL(request.url).search;
                return HttpResponse.json({
                    data: [
                        valheimCharacterUnclaimed,
                        valheimCharacterClaimed,
                        valheimCharacterAssigned,
                    ],
                });
            }),
        );
        renderTab();
        const list = await screen.findByRole('list');
        expect(asked).toBe('?serverId=7&page=1&pageSize=50');
        expect(within(list).getAllByRole('listitem')).toHaveLength(3);
        expect(
            screen.getByRole('heading', { name: 'Characters 3' }),
        ).toBeInTheDocument();
        expect(screen.getByText('Unclaimed')).toHaveAttribute(
            'data-tone',
            'warning',
        );
        expect(screen.getAllByText('member1')).toHaveLength(2);
        expect(screen.getAllByText('World Midgard')).toHaveLength(3);
    });

    it('opens a character page and carries the hub path for the crumb', async () => {
        server.use(valheimCharactersHandler([valheimCharacterClaimed]));
        renderTab();
        await userEvent.click(
            await screen.findByRole('button', { name: 'Open Hrafn' }),
        );
        expect(
            screen.getByText(
                'landed /valheim/characters/12 from {"hubPath":"/guilds/4#characters"}',
            ),
        ).toBeInTheDocument();
    });
});

describe('ValheimCharactersTab (cont.)', () => {
    it('says what to do when the server has no characters', async () => {
        server.use(valheimCharactersHandler([]));
        renderTab();
        expect(
            await screen.findByText(/No characters yet/),
        ).toBeInTheDocument();
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('shows an alert when the list fails', async () => {
        server.use(
            http.get(VALHEIM_CHARACTERS_URL, () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 }),
            ),
        );
        renderTab();
        expect(await screen.findByRole('alert')).toHaveTextContent(
            "Couldn't load characters",
        );
    });
});
