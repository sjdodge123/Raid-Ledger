import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { OllamaSetupCard } from './ollama-setup-card';
import type { AiProviderInfoDto } from '@raid-ledger/contract';

vi.mock('../../../hooks/use-auth', () => ({
    getAuthToken: vi.fn(() => 'test-token'),
}));

const API = 'http://localhost:3000';

function createOllamaProvider(overrides: Partial<AiProviderInfoDto> = {}): AiProviderInfoDto {
    return {
        key: 'ollama',
        displayName: 'Ollama (Local)',
        requiresApiKey: false,
        selfHosted: true,
        configured: true,
        available: false,
        active: false,
        ...overrides,
    };
}

describe('OllamaSetupCard', () => {
    beforeEach(() => {
        server.use(
            http.post(`${API}/admin/ai/providers/ollama/setup`, () =>
                HttpResponse.json({ step: 'ready', message: 'Ollama is ready', success: true }),
            ),
            http.post(`${API}/admin/ai/providers/ollama/stop`, () =>
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

    it('renders the Ollama card title', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider()} />);
        expect(screen.getByText('Ollama (Local)')).toBeInTheDocument();
    });

    it('shows Offline badge when not available', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider()} />);
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('shows Running badge when available', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider({ available: true })} />);
        expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('shows Active badge when active', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider({ active: true, available: true })} />);
        expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('shows Setup Ollama button when not available', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider()} />);
        expect(screen.getByRole('button', { name: /setup ollama/i })).toBeInTheDocument();
    });

    it('shows Stop button when available', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider({ available: true })} />);
        expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
    });

    it('shows Set as Active button when available but not active', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider({ available: true })} />);
        expect(screen.getByRole('button', { name: /set as active/i })).toBeInTheDocument();
    });

    it('hides Set as Active button when already active', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider({ available: true, active: true })} />);
        expect(screen.queryByRole('button', { name: /set as active/i })).not.toBeInTheDocument();
    });

    it('shows description text', () => {
        renderWithProviders(<OllamaSetupCard provider={createOllamaProvider()} />);
        expect(screen.getByText(/Self-hosted LLM inference via Docker/)).toBeInTheDocument();
    });

    describe('Regression: ROK-840', () => {
        it('shows progress bar when setupInProgress from server (refresh scenario)', () => {
            const provider = createOllamaProvider({
                setupInProgress: true,
                setupStep: 'pulling_model',
            });

            renderWithProviders(<OllamaSetupCard provider={provider} />);

            expect(screen.getByText(/pulling default model/i)).toBeInTheDocument();
            expect(screen.getByText(/setting up/i)).toBeInTheDocument();
        });

        it('hides setup button when setup is in progress from server', () => {
            const provider = createOllamaProvider({
                setupInProgress: true,
                setupStep: 'starting',
            });

            renderWithProviders(<OllamaSetupCard provider={provider} />);

            expect(
                screen.queryByRole('button', { name: /setup ollama/i }),
            ).not.toBeInTheDocument();
        });

        it('shows error step text when setup errored', () => {
            const provider = createOllamaProvider({
                setupInProgress: false,
                setupStep: 'error',
                error: 'Model pull failed',
            });

            renderWithProviders(<OllamaSetupCard provider={provider} />);

            // Error state should not show progress bar
            expect(
                screen.queryByText(/pulling default model/i),
            ).not.toBeInTheDocument();
        });
    });
});
