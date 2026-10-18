/** The `pelican-server:row-extras` slot renders in the desktop row and the phone card (ROK-1833). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import '../../valheim/register';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { pelicanServerFixture } from '../../../test/mocks/pelican-handlers';
import { VALHEIM_LINK_TOKENS_URL, valheimTokenNone } from '../../../test/mocks/valheim-link-handlers';
import { usePluginStore } from '../../../stores/plugin-store';
import { PelicanServerCard, PelicanServerRow } from './pelican-server-row';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const row = { ...pelicanServerFixture, id: 7 };

beforeEach(() => {
    usePluginStore.setState({ activeSlugs: new Set(['pelican', 'valheim']), initialized: true });
    server.use(http.get(VALHEIM_LINK_TOKENS_URL, () => HttpResponse.json({ data: [valheimTokenNone] })));
});

describe('pelican-server:row-extras', () => {
    it('renders the Valheim control in the table row', async () => {
        renderWithProviders(<table><tbody><PelicanServerRow row={row} showExtras suggestions={[]} onUpdate={vi.fn()} /></tbody></table>);
        expect(await screen.findByTestId('valheim-link-token-7')).toBeInTheDocument();
    });

    it('renders the Valheim control in the phone card', async () => {
        renderWithProviders(<PelicanServerCard row={row} suggestions={[]} onUpdate={vi.fn()} />);
        expect(await screen.findByTestId('valheim-link-token-7')).toBeInTheDocument();
    });

    it('renders nothing while the Valheim plugin is inactive', () => {
        usePluginStore.setState({ activeSlugs: new Set(['pelican']), initialized: true });
        renderWithProviders(<PelicanServerCard row={row} suggestions={[]} onUpdate={vi.fn()} />);
        expect(screen.queryByTestId('valheim-link-token-7')).not.toBeInTheDocument();
    });
});
