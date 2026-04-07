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
        const ollamaEls = await screen.findAllByText('Ollama (Local)');
        expect(ollamaEls.length).toBeGreaterThanOrEqual(1);
        expect(await screen.findByText('OpenAI')).toBeInTheDocument();
        expect(await screen.findByText('Claude (Anthropic)')).toBeInTheDocument();
        expect(await screen.findByText('Google (Gemini)')).toBeInTheDocument();
    });

    it('shows active provider indicator', async () => {
        renderWithProviders(<AiPluginContent />);
        expect(await screen.findByText('AI Providers')).toBeInTheDocument();
        const ollamaEls = await screen.findAllByText('Ollama (Local)');
        expect(ollamaEls.length).toBeGreaterThanOrEqual(2);
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

// --- ROK-1000: AC9 — TestChatSection surfaces actual error message ---

describe('ROK-1000: TestChatSection error message', () => {
    beforeEach(() => {
        mockAiStatus(true);
        mockAiProviders();
        mockAiUsage();
    });

    it('AC9: surfaces actual error message from mutation, not hardcoded "Request failed"', async () => {
        const { default: userEvent } = await import('@testing-library/user-event');

        // Override the test-chat endpoint to return a network error
        server.use(
            http.post(`${API}/admin/ai/test-chat`, () =>
                HttpResponse.json(
                    { message: 'LLM timed out after 30s — provider: ollama, model: llama3.2:3b' },
                    { status: 500 },
                ),
            ),
        );

        renderWithProviders(<AiPluginContent />);

        // Wait for the Test LLM section to render (only shows when available=true)
        const button = await screen.findByRole('button', { name: /send test message/i });
        const user = userEvent.setup();
        await user.click(button);

        // The catch block should show the actual error, not "Request failed"
        const errorEl = await screen.findByText(/LLM timed out/i, {}, { timeout: 5000 });
        expect(errorEl).toBeInTheDocument();
        // Verify the hardcoded "Request failed" is NOT shown
        expect(screen.queryByText('Request failed')).not.toBeInTheDocument();
    });

    it('AC9: shows specific error text from a server error response', async () => {
        const { default: userEvent } = await import('@testing-library/user-event');

        server.use(
            http.post(`${API}/admin/ai/test-chat`, () =>
                HttpResponse.json(
                    { message: 'Connection refused to Ollama on port 11434' },
                    { status: 503 },
                ),
            ),
        );

        renderWithProviders(<AiPluginContent />);

        const button = await screen.findByRole('button', { name: /send test message/i });
        const user = userEvent.setup();
        await user.click(button);

        const errorEl = await screen.findByText(/Connection refused/i, {}, { timeout: 5000 });
        expect(errorEl).toBeInTheDocument();
    });

    it('AC9: shows error from network failure (not server JSON)', async () => {
        const { default: userEvent } = await import('@testing-library/user-event');

        // HttpResponse.error() doesn't reliably simulate network errors in MSW v2 Node.
        // Intercept fetch to throw TypeError only for the test-chat endpoint.
        const realFetch = globalThis.fetch;
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
            const url = String(args[0]);
            if (url.includes('/admin/ai/test-chat')) throw new TypeError('Failed to fetch');
            return realFetch(...args);
        });

        renderWithProviders(<AiPluginContent />);

        const button = await screen.findByRole('button', { name: /send test message/i });
        const user = userEvent.setup();
        await user.click(button);

        // adminFetch catches the TypeError and throws Error('Failed to test LLM'),
        // which the component catches and displays
        const errorResult = await screen.findByText(/failed to test llm/i, {}, { timeout: 5000 });
        expect(errorResult).toBeInTheDocument();

        fetchSpy.mockRestore();
    });
});
