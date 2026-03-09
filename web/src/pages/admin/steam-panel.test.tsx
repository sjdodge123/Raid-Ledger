/**
 * Unit tests for SteamPanel admin page (ROK-745).
 * Verifies: heading, description, IntegrationCard rendering with status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { SteamPanel } from './steam-panel';

const API_BASE = 'http://localhost:3000';

vi.mock('../../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => 'test-token'),
}));

function setupSteamHandler(configured = false, status = 200) {
    server.use(
        http.get(`${API_BASE}/admin/settings/steam`, () => {
            if (status !== 200) {
                return HttpResponse.json({ message: 'error' }, { status });
            }
            return HttpResponse.json({ configured });
        }),
    );
}

describe('SteamPanel — rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupSteamHandler(false);
    });

    it('renders the Steam heading', async () => {
        renderWithProviders(<SteamPanel />);
        const headings = screen.getAllByText('Steam');
        expect(headings.length).toBeGreaterThanOrEqual(1);
    });

    it('renders the description text in both heading and card', () => {
        renderWithProviders(<SteamPanel />);
        const descriptions = screen.getAllByText(
            /enable steam account linking and game library sync/i,
        );
        expect(descriptions).toHaveLength(2);
    });

    it('shows Offline status badge when Steam is not configured', async () => {
        setupSteamHandler(false);
        renderWithProviders(<SteamPanel />);

        expect(
            await screen.findByText('Offline'),
        ).toBeInTheDocument();
    });

    it('shows Online status badge when Steam is configured', async () => {
        setupSteamHandler(true);
        renderWithProviders(<SteamPanel />);

        expect(
            await screen.findByText('Online'),
        ).toBeInTheDocument();
    });

    it('renders the Steam Web API Key label for the form', async () => {
        renderWithProviders(<SteamPanel />);

        expect(
            await screen.findByText('Steam Web API Key'),
        ).toBeInTheDocument();
    });

    it('renders the Save API Key button', async () => {
        renderWithProviders(<SteamPanel />);

        expect(
            await screen.findByRole('button', { name: /save api key/i }),
        ).toBeInTheDocument();
    });

    it('shows api key link to steamcommunity.com', async () => {
        renderWithProviders(<SteamPanel />);

        const link = await screen.findByRole('link', {
            name: /steamcommunity.com\/dev\/apikey/i,
        });
        expect(link).toHaveAttribute(
            'href',
            'https://steamcommunity.com/dev/apikey',
        );
        expect(link).toHaveAttribute('target', '_blank');
    });
});

describe('SteamPanel — configured state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupSteamHandler(true);
    });

    it('shows Test Connection button when configured', async () => {
        renderWithProviders(<SteamPanel />);

        expect(
            await screen.findByText('Test Connection'),
        ).toBeInTheDocument();
    });

    it('shows Clear button when configured', async () => {
        renderWithProviders(<SteamPanel />);

        expect(
            await screen.findByText('Clear'),
        ).toBeInTheDocument();
    });

    it('shows configured status message', async () => {
        renderWithProviders(<SteamPanel />);

        expect(
            await screen.findByText('Steam API key is configured'),
        ).toBeInTheDocument();
    });
});
