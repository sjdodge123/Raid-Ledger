import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { LoginPage } from './login-page';
import * as useSystemStatusModule from '../hooks/use-system-status';

// Mock the hooks
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({
        login: vi.fn(),
    }),
}));

vi.mock('../hooks/use-system-status');

// Type-safe mock helper
function mockSystemStatus(data: { isFirstRun: boolean; discordConfigured: boolean }) {
    vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
        data,
        isLoading: false,
        error: null,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSystemStatusModule.useSystemStatus>);
}

// Wrapper for router context
const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('LoginPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders login form with username field', () => {
        mockSystemStatus({ isFirstRun: false, discordConfigured: false });

        renderWithRouter(<LoginPage />);

        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('hides Discord button when discordConfigured is false', () => {
        mockSystemStatus({ isFirstRun: false, discordConfigured: false });

        renderWithRouter(<LoginPage />);

        expect(screen.queryByText(/login with discord/i)).not.toBeInTheDocument();
    });

    it('shows Discord button when discordConfigured is true', () => {
        mockSystemStatus({ isFirstRun: false, discordConfigured: true });

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/login with discord/i)).toBeInTheDocument();
    });

    it('displays community name from env variable', () => {
        mockSystemStatus({ isFirstRun: false, discordConfigured: false });

        renderWithRouter(<LoginPage />);

        // Default community name when VITE_COMMUNITY_NAME is not set
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/raid-ledger/i);
    });

    it('shows first-run hint when isFirstRun is true', () => {
        mockSystemStatus({ isFirstRun: true, discordConfigured: false });

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/first time/i)).toBeInTheDocument();
        expect(screen.getByText(/container logs/i)).toBeInTheDocument();
    });

    it('hides first-run hint when isFirstRun is false', () => {
        mockSystemStatus({ isFirstRun: false, discordConfigured: false });

        renderWithRouter(<LoginPage />);

        expect(screen.queryByText(/first time/i)).not.toBeInTheDocument();
    });

    it('displays tagline below login card', () => {
        mockSystemStatus({ isFirstRun: false, discordConfigured: false });

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/coordinate raids\. track attendance\. conquer together\./i)).toBeInTheDocument();
    });
});
