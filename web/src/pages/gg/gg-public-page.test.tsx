/** ROK-2187 — `/w/:slug` shows the summary only: a people COUNT, never a name (Q4). */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { ggHandlers } from '../../test/mocks/gg-handlers';
import { ggSnapshotFixture } from '../../test/mocks/fixtures/gg-fixtures';
import { GgPublicPage } from './gg-public-page';

function renderPublic(): void {
    renderWithProviders(<Routes><Route path="/w/:slug" element={<GgPublicPage />} /></Routes>, { initialEntries: ['/w/abcdefghijklmnop1234'] });
}

describe('GG public page (ROK-2187)', () => {
    it('renders the summary with a people count and no other player names', async () => {
        server.use(...ggHandlers(ggSnapshotFixture()));
        renderPublic();
        expect(await screen.findByText('Kestrel · GG 2026')).toBeInTheDocument();
        expect(screen.getByText('people played with').previousSibling).toHaveTextContent('38');
        expect(screen.getByText('WoW: Forever')).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('Brindle');
    });

    it('a revoked link shows the not-shared state', async () => {
        server.use(http.get('http://localhost:3000/gg/public/:slug', () => HttpResponse.json({ message: 'Not found' }, { status: 404 })));
        renderPublic();
        expect(await screen.findByTestId('gg-public-missing')).toBeInTheDocument();
    });
});
