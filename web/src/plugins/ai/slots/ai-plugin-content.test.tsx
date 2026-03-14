import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { AiPluginContent } from './ai-plugin-content';

vi.mock('../../../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => 'test-token'),
}));

const API = 'http://localhost:3000';

function mockAiStatus(available: boolean) {
    server.use(
        http.get(`${API}/admin/ai/status`, () =>
            HttpResponse.json({
                provider: 'ollama',
                providerName: 'Ollama (Local)',
                available,
                currentModel: 'llama3.2:3b',
                selfHosted: true,
                dockerStatus: available ? 'running' : 'unknown',
            }),
        ),
    );
}

function mockAiModels() {
    server.use(
        http.get(`${API}/admin/ai/models`, () =>
            HttpResponse.json([
                { id: 'llama3.2:3b', name: 'llama3.2:3b' },
            ]),
        ),
    );
}

function mockAiUsage() {
    server.use(
        http.get(`${API}/admin/ai/usage`, () =>
            HttpResponse.json({
                totalRequests: 50,
                requestsToday: 10,
                avgLatencyMs: 150,
                errorRate: 0.02,
                byFeature: [],
            }),
        ),
    );
}

describe('AiPluginContent', () => {
    beforeEach(() => {
        mockAiStatus(true);
        mockAiModels();
        mockAiUsage();
    });

    it('renders the integration card with title', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('AI Features')).toBeInTheDocument();
    });

    it('shows Online status when provider is available', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('Online')).toBeInTheDocument();
    });

    it('shows Offline status when provider is unavailable', async () => {
        mockAiStatus(false);
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('Offline')).toBeInTheDocument();
    });

    it('renders hardware warning', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(
            await screen.findByText('Self-Hosted Requirements:'),
        ).toBeInTheDocument();
    });

    it('renders test connection button', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(
            await screen.findByRole('button', { name: /test connection/i }),
        ).toBeInTheDocument();
    });

    it('returns null when pluginSlug does not match', () => {
        const { container } = renderWithProviders(
            <AiPluginContent pluginSlug="blizzard" />,
        );
        expect(container.firstChild).toBeNull();
    });
});
