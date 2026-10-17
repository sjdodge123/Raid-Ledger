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

/** Class strings of every element outside a Button (the primitive owns its variant paint). */
function nonButtonClasses(root: Element): string {
    return Array.from(root.querySelectorAll('[class]'))
        .filter((el) => el.closest('button') === null)
        .map((el) => el.getAttribute('class') ?? '').join(' ');
}

describe('CloudProviderCard — API key field and disclosure', () => {
    it('names the API key input "API key" and keeps its placeholder', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        expect(screen.queryByLabelText('API key')).toBe(screen.getByPlaceholderText('Enter API key'));
    });

    it('"Show API key" points at the API key input', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        const input = screen.getByPlaceholderText('Enter API key');
        expect(screen.getByRole('button', { name: /show api key/i })).toHaveAttribute('aria-controls', input.id);
    });

    it('the "How to get an API key" disclosure flips aria-expanded and reveals the steps', async () => {
        const user = userEvent.setup();
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        const toggle = screen.getByRole('button', { name: /how to get an api key/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('link', { name: /open openai console/i })).toBeInTheDocument();
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });
});

describe('CloudProviderCard — loading buttons', () => {
    it('Save is loading and swallows clicks while the configure request is pending', async () => {
        let calls = 0;
        server.use(http.post(`${API}/admin/ai/providers/:key/configure`, () => { calls += 1; return new Promise<never>(() => {}); }));
        const user = userEvent.setup();
        renderWithProviders(<CloudProviderCard provider={createProvider()} />);
        await user.type(screen.getByPlaceholderText('Enter API key'), 'sk-test');
        const save = screen.getByRole('button', { name: /save/i });
        await user.click(save);
        await vi.waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
        expect(save).toHaveAttribute('aria-disabled', 'true');
        await user.click(save);
        expect(calls).toBe(1);
    });

    it('Set as Active is secondary, loading and swallows clicks while pending', async () => {
        let calls = 0;
        server.use(http.post(`${API}/admin/ai/providers/:key/activate`, () => { calls += 1; return new Promise<never>(() => {}); }));
        const user = userEvent.setup();
        renderWithProviders(<CloudProviderCard provider={createProvider({ configured: true })} />);
        const activate = screen.getByRole('button', { name: /set as active/i });
        expect(activate.className).toContain('bg-panel');
        await user.click(activate);
        await vi.waitFor(() => expect(activate).toHaveAttribute('aria-busy', 'true'));
        expect(activate).toHaveAttribute('aria-disabled', 'true');
        await user.click(activate);
        expect(calls).toBe(1);
    });
});

describe('CloudProviderCard — theme tokens', () => {
    it('the Active pill uses the success token', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ active: true, available: true })} />);
        expect(screen.getByText('Active').className).toContain('text-success');
    });

    it('the Selected · Offline pill uses the warning token', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ active: true, available: false })} />);
        expect(screen.getByText('Selected · Offline').className).toContain('text-warning');
    });

    it('the Configured pill is neutral', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ configured: true })} />);
        const pill = screen.getByText('Configured');
        expect(pill.className).toContain('text-secondary');
        expect(pill.className).toContain('bg-overlay');
    });

    it('the provider error uses the warning token', () => {
        renderWithProviders(<CloudProviderCard provider={createProvider({ error: 'Key rejected' })} />);
        expect(screen.getByText('Key rejected').className).toContain('text-warning');
    });

    it('renders no raw palette hues outside its buttons', async () => {
        const user = userEvent.setup();
        const { container } = renderWithProviders(
            <CloudProviderCard provider={createProvider({ configured: true, error: 'Key rejected' })} />,
        );
        await user.click(screen.getByRole('button', { name: /how to get an api key/i }));
        expect(nonButtonClasses(container)).not.toMatch(/-(purple|emerald|amber|blue|red)-\d{3}/);
    });
});
