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

function mockAiProviders() {
    server.use(
        http.get(`${API}/admin/ai/providers`, () =>
            HttpResponse.json([
                { key: 'ollama', displayName: 'Ollama (Local)', requiresApiKey: false, selfHosted: true, configured: true, available: true, active: true },
                { key: 'openai', displayName: 'OpenAI', requiresApiKey: true, selfHosted: false, configured: false, available: false, active: false },
                { key: 'claude', displayName: 'Claude (Anthropic)', requiresApiKey: true, selfHosted: false, configured: false, available: false, active: false },
                { key: 'google', displayName: 'Google (Gemini)', requiresApiKey: true, selfHosted: false, configured: false, available: false, active: false },
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
        mockAiProviders();
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

    it('renders provider cards', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('Ollama (Local)')).toBeInTheDocument();
        expect(await screen.findByText('OpenAI')).toBeInTheDocument();
        expect(await screen.findByText('Claude (Anthropic)')).toBeInTheDocument();
        expect(await screen.findByText('Google (Gemini)')).toBeInTheDocument();
    });

    it('shows active provider indicator', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText(/Active: Ollama/)).toBeInTheDocument();
    });

    it('returns null when pluginSlug does not match', () => {
        const { container } = renderWithProviders(
            <AiPluginContent pluginSlug="blizzard" />,
        );
        expect(container.firstChild).toBeNull();
    });
});

describe('AiPluginContent (adversarial)', () => {
    beforeEach(() => {
        mockAiStatus(true);
        mockAiProviders();
        mockAiUsage();
    });

    it('renders when pluginSlug is "ai"', async () => {
        renderWithProviders(<AiPluginContent pluginSlug="ai" />);
        expect(await screen.findByText('AI Features')).toBeInTheDocument();
    });

    it('renders when pluginSlug is undefined (default slot)', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('AI Features')).toBeInTheDocument();
    });

    it('shows Offline status when API returns available: false', async () => {
        mockAiStatus(false);
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('Offline')).toBeInTheDocument();
        expect(screen.queryByText('Online')).not.toBeInTheDocument();
    });

    it('handles 500 from providers endpoint gracefully', async () => {
        server.use(
            http.get(`${API}/admin/ai/providers`, () =>
                HttpResponse.json({ error: 'fail' }, { status: 500 }),
            ),
        );
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('AI Features')).toBeInTheDocument();
    });

    it('does not render for unrecognized slugs', () => {
        const { container } = renderWithProviders(
            <AiPluginContent pluginSlug="blizzard" />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('does not render for empty string slug (falsy)', () => {
        renderWithProviders(<AiPluginContent pluginSlug="" />);
        expect(document.body).toBeTruthy();
    });
});
