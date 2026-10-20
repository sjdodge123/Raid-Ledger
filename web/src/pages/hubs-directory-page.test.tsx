/** ROK-1870 W5/W6 — the `/hubs` community hub directory. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { communityHubHandlers, createMockHubDirectoryPage, createMockHubEntry } from '../test/handlers/community-hubs';
import { mockDesktop } from '../test/handlers/media';
import { HubsDirectoryPage } from './hubs-directory-page';

const API = 'http://localhost:3000';

function LocationProbe(): JSX.Element {
    const { pathname, search } = useLocation();
    return <output data-testid="location">{pathname + search}</output>;
}

function renderPage(entry = '/hubs'): void {
    renderWithProviders(<><HubsDirectoryPage /><LocationProbe /></>, { initialEntries: [entry] });
}

afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });

describe('HubsDirectoryPage', () => {
    it('W5: Game + Joined land in the URL, the badge reads 2 and the request carries both', async () => {
        const seen: URLSearchParams[] = [];
        server.use(
            http.get(`${API}/hubs`, ({ request }) => {
                seen.push(new URL(request.url).searchParams);
                return HttpResponse.json(createMockHubDirectoryPage());
            }),
        );
        mockDesktop(true);
        renderPage('/hubs?game=5');
        expect(await screen.findByText('Tavern Regulars')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        await userEvent.click(screen.getByRole('radio', { name: 'Joined' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?game=5&membership=joined'));
        expect(within(screen.getByRole('button', { name: /^Filters/ })).getByText('2')).toBeInTheDocument();
        await waitFor(() => {
            const last = seen.at(-1);
            expect(last?.get('gameId')).toBe('5');
            expect(last?.get('membership')).toBe('joined');
        });
    });

    it('W6: Join flips the card to Joined in place and adds a member', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items: [createMockHubEntry({ memberCount: 14 })] }) }));
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Join Tavern Regulars' }));
        const card = screen.getByTestId('hub-directory-card');
        expect(await within(card).findByText('Joined')).toBeInTheDocument();
        expect(within(card).getByText(/15 members/)).toBeInTheDocument();
        expect(screen.getByTestId('location').textContent).toBe('/hubs');
    });

    it('loads the next cursor page on Load more', async () => {
        server.use(http.get(`${API}/hubs`, ({ request }) => {
            const cursor = new URL(request.url).searchParams.get('cursor');
            return HttpResponse.json(cursor
                ? createMockHubDirectoryPage({ items: [createMockHubEntry({ id: 2, name: 'Tactician Crew' })] })
                : createMockHubDirectoryPage({ nextCursor: 'c1', total: 2 }));
        }));
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
        expect(await screen.findByText('Tactician Crew')).toBeInTheDocument();
        expect(screen.getByText('Tavern Regulars')).toBeInTheDocument();
    });

    it('shows the no-hubs empty state', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items: [] }) }));
        renderPage();
        expect(await screen.findByText("No community hubs yet. Start one from a game's page.")).toBeInTheDocument();
    });

    it('offers Clear filters when the filters match nothing', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items: [] }) }));
        renderPage('/hubs?membership=joined');
        await userEvent.click(await screen.findByRole('button', { name: 'Clear filters' }));
        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/hubs'));
    });
});
