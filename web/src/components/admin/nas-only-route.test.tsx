/**
 * ROK-1700 — NasOnlyRoute: a direct URL to a NAS-only settings page (Demo
 * Data, Co-Optimus) redirects to General under the cloud flavour, and renders
 * the page under nas or when the api sends no flavour.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { NasOnlyRoute } from './nas-only-route';
import { DemoDataPanel } from '../../pages/admin/demo-data-panel';

const API = 'http://localhost:3000';

function mockStatus(body: Record<string, unknown>) {
    server.use(http.get(`${API}/system/status`, () => HttpResponse.json(body)));
}

function renderAt(child: React.ReactNode) {
    return renderWithProviders(
        <Routes>
            <Route path="/admin/settings/general" element={<p>General settings page</p>} />
            <Route path="/admin/settings/general/data" element={<NasOnlyRoute>{child}</NasOnlyRoute>} />
        </Routes>,
        { initialEntries: ['/admin/settings/general/data'] },
    );
}

describe('NasOnlyRoute (ROK-1700)', () => {
    it('cloud: the Demo Data panel never renders — the URL lands on General', async () => {
        mockStatus({ status: 'ok', flavour: 'cloud' });
        const { queryClient } = renderAt(<DemoDataPanel />);
        await waitFor(() => expect(queryClient.getQueryState(['system', 'status'])?.status).toBe('success'));
        expect(screen.queryByRole('heading', { name: 'Demo Data' })).not.toBeInTheDocument();
        expect(screen.getByText('General settings page')).toBeInTheDocument();
    });

    it.each([
        ['nas', { status: 'ok', flavour: 'nas' }],
        ['missing flavour', { status: 'ok' }],
    ])('%s: renders the page', async (_label, body) => {
        mockStatus(body);
        const { queryClient } = renderAt(<p>NAS-only page</p>);
        await waitFor(() => expect(queryClient.getQueryState(['system', 'status'])?.status).toBe('success'));
        expect(screen.getByText('NAS-only page')).toBeInTheDocument();
        expect(screen.queryByText('General settings page')).not.toBeInTheDocument();
    });
});
