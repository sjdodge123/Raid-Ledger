/** The `Mod link` column shows only while an active plugin fills `pelican-server:row-extras` (ROK-1833). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import '../../valheim/register';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { pelicanServerFixture } from '../../../test/mocks/pelican-handlers';
import { VALHEIM_LINK_TOKENS_URL, valheimTokenNone } from '../../../test/mocks/valheim-link-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { PelicanServersTable } from './pelican-servers-table';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const originalMatchMedia = window.matchMedia;
const row = { ...pelicanServerFixture, id: 7 };

function setDesktop(): void {
    window.matchMedia = (query: string) => ({
        matches: query === DESKTOP_MQ, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    });
}

function renderTable(): void {
    renderWithProviders(<PelicanServersTable rows={[row]} onUpdate={vi.fn()} />);
}

beforeEach(() => {
    setDesktop();
    server.use(http.get(VALHEIM_LINK_TOKENS_URL, () => HttpResponse.json({ data: [valheimTokenNone] })));
});

afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('PelicanServersTable — Mod link column', () => {
    it('shows the header and the cell while a plugin fills the slot', async () => {
        usePluginStore.setState({ activeSlugs: new Set(['pelican', 'valheim']), initialized: true });
        renderTable();
        expect(screen.getByRole('columnheader', { name: 'Mod link' })).toBeInTheDocument();
        expect(within(screen.getByTestId('pelican-server-row-7')).getAllByRole('cell')).toHaveLength(7);
        expect(await screen.findByTestId('valheim-link-token-7')).toBeInTheDocument();
    });

    it('hides the header and the cell when no active plugin fills the slot', () => {
        usePluginStore.setState({ activeSlugs: new Set(['pelican']), initialized: true });
        renderTable();
        expect(screen.queryByRole('columnheader', { name: 'Mod link' })).not.toBeInTheDocument();
        expect(screen.getAllByRole('columnheader')).toHaveLength(6);
        expect(within(screen.getByTestId('pelican-server-row-7')).getAllByRole('cell')).toHaveLength(6);
    });
});
