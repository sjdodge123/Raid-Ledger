import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { CloudProviderCard } from './cloud-provider-card';
import type { AiProviderInfoDto } from '@raid-ledger/contract';

vi.mock('../../../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => 'test-token'),
}));

const API = 'http://localhost:3000';

function createProvider(overrides: Partial<AiProviderInfoDto> = {}): AiProviderInfoDto {
    return {
        key: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        selfHosted: false,
        configured: false,
        available: false,
        active: false,
        ...overrides,
    };
}

describe('CloudProviderCard', () => {
    beforeEach(() => {
        server.use(
            http.post(`${API}/admin/ai/providers/:key/configure`, () =>
                HttpResponse.json({ success: true }),
            ),
            http.post(`${API}/admin/ai/providers/:key/activate`, () =>
                HttpResponse.json({ success: true }),
            ),
            http.get(`${API}/admin/ai/providers`, () =>
                HttpResponse.json([]),
            ),
        );
    });

    it('renders the provider display name', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        expect(screen.getByText('OpenAI')).toBeInTheDocument();
    });

    it('shows "Not Configured" badge when not configured', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        expect(screen.getByText('Not Configured')).toBeInTheDocument();
    });

    it('shows "Configured" badge when configured', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ configured: true })} />);
        expect(screen.getByText('Configured')).toBeInTheDocument();
    });

    it('shows "Active" badge when active and available', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ active: true, available: true })} />);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('renders API key input', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        expect(screen.getByPlaceholderText('Enter API key')).toBeInTheDocument();
    });

    it('renders Save button', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    it('shows Set as Active button when configured but not active', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ configured: true })} />);
        expect(screen.getByRole('button', { name: /set as active/i })).toBeInTheDocument();
    });

    it('hides Set as Active button when already active', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ active: true, configured: true })} />);
        expect(screen.queryByRole('button', { name: /set as active/i })).not.toBeInTheDocument();
    });

    it('toggles API key visibility', async () => {
        const user = userEvent.setup();
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        const input = screen.getByPlaceholderText('Enter API key');
        expect(input).toHaveAttribute('type', 'password');
        await user.click(screen.getByRole('button', { name: /show api key/i }));
        expect(input).toHaveAttribute('type', 'text');
    });
});
