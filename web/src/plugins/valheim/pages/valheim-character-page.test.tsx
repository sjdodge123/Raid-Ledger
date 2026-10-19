/** ROK-1836 — the character page shell: header, four section slots, crumb, 404 / error / bad-id states. */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    VALHEIM_CHARACTER_URL,
    valheimCharacterDetail,
    valheimCharacterHandler,
    valheimCharacterUnclaimed,
} from '../../../test/mocks/valheim-armory-handlers';
import { ValheimCharacterPage } from './valheim-character-page';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

function renderPage(path: string, state?: unknown) {
    return renderWithProviders(
        <Routes>
            <Route
                path="/valheim/characters/:id"
                element={<ValheimCharacterPage />}
            />
        </Routes>,
        { initialEntries: [{ pathname: path, state }] },
    );
}

describe('ValheimCharacterPage', () => {
    it('renders the header and the four section slots in order', async () => {
        server.use(valheimCharacterHandler(valheimCharacterDetail()));
        renderPage('/valheim/characters/12');
        expect(
            await screen.findByRole('heading', { level: 1, name: 'Hrafn' }),
        ).toBeInTheDocument();
        expect(screen.getByText('Fixtureheim server')).toBeInTheDocument();
        expect(screen.getByText('Owned by')).toBeInTheDocument();
        expect(screen.getByText('Claimed')).toHaveAttribute(
            'title',
            'The owner claimed this character',
        );
        expect(screen.getByText(/· game 0\.220\.5$/)).toBeInTheDocument();
        const titles = screen
            .getAllByRole('heading', { level: 2 })
            .map((h) => h.textContent);
        expect(titles).toEqual([
            'Equipment',
            'Skills',
            'Inventory',
            'Trophies',
        ]);
        expect(
            screen.getByRole('region', { name: 'Inventory' }),
        ).toBeInTheDocument();
    });

    it('shows Unclaimed for a character with no owner', async () => {
        server.use(
            valheimCharacterHandler(
                valheimCharacterDetail({ ...valheimCharacterUnclaimed }),
            ),
        );
        renderPage('/valheim/characters/11');
        expect(await screen.findByText('No owner yet')).toBeInTheDocument();
        expect(screen.getByText('Unclaimed')).toHaveAttribute(
            'data-tone',
            'warning',
        );
    });

    it('links back to the hub tab it was opened from', async () => {
        server.use(valheimCharacterHandler(valheimCharacterDetail()));
        renderPage('/valheim/characters/12', {
            hubPath: '/guilds/4#characters',
        });
        const crumb = await screen.findByRole('link', {
            name: 'Fixtureheim · Characters',
        });
        expect(crumb).toHaveAttribute('href', '/guilds/4#characters');
    });
});

describe('ValheimCharacterPage (cont.)', () => {
    it('falls back to the detail hub id on a cold deep link', async () => {
        server.use(valheimCharacterHandler(valheimCharacterDetail({ hubId: 4 })));
        renderPage('/valheim/characters/12');
        const crumb = await screen.findByRole('link', {
            name: 'Fixtureheim · Characters',
        });
        expect(crumb).toHaveAttribute('href', '/guilds/4#characters');
    });

    it('draws no crumb on a cold deep link with no hub id in the detail', async () => {
        server.use(valheimCharacterHandler(valheimCharacterDetail()));
        renderPage('/valheim/characters/12');
        await screen.findByRole('heading', { level: 1 });
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('shows the not-found state on a 404 without an alert', async () => {
        server.use(valheimCharacterHandler(null));
        renderPage('/valheim/characters/99');
        expect(
            await screen.findByText(/This character doesn't exist/),
        ).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows not-found for a malformed id without calling the API', async () => {
        let called = false;
        server.use(
            http.get(VALHEIM_CHARACTER_URL, () => {
                called = true;
                return HttpResponse.json({});
            }),
        );
        renderPage('/valheim/characters/abc');
        expect(
            screen.getByText(/This character doesn't exist/),
        ).toBeInTheDocument();
        expect(called).toBe(false);
    });

    it('raises an alert on a server error', async () => {
        server.use(
            http.get(VALHEIM_CHARACTER_URL, () =>
                HttpResponse.json({ message: 'boom' }, { status: 500 }),
            ),
        );
        renderPage('/valheim/characters/12');
        expect(
            await screen.findByRole('alert', {}, { timeout: 5000 }),
        ).toHaveTextContent("Couldn't load this character");
    });
});
