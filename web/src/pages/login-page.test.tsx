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

// Wrapper for router context
const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('LoginPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders login form with username field', () => {
        vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: false, discordConfigured: false },
            isLoading: false,
            error: null,
        } as any);

        renderWithRouter(<LoginPage />);

        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('hides Discord button when discordConfigured is false', () => {
        vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: false, discordConfigured: false },
            isLoading: false,
            error: null,
        } as any);

        renderWithRouter(<LoginPage />);

        expect(screen.queryByText(/login with discord/i)).not.toBeInTheDocument();
    });

    it('shows Discord button when discordConfigured is true', () => {
        vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: false, discordConfigured: true },
            isLoading: false,
            error: null,
        } as any);

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/login with discord/i)).toBeInTheDocument();
    });

    it('displays community name from env variable', () => {
        vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: false, discordConfigured: false },
            isLoading: false,
            error: null,
        } as any);

        renderWithRouter(<LoginPage />);

        // Default community name when VITE_COMMUNITY_NAME is not set
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/raid-ledger/i);
    });

    it('shows first-run hint when isFirstRun is true', () => {
        vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: true, discordConfigured: false },
            isLoading: false,
            error: null,
        } as any);

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/first time/i)).toBeInTheDocument();
        expect(screen.getByText(/container logs/i)).toBeInTheDocument();
    });

    it('hides first-run hint when isFirstRun is false', () => {
        vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: false, discordConfigured: false },
            isLoading: false,
            error: null,
        } as any);

        renderWithRouter(<LoginPage />);

        expect(screen.queryByText(/first time/i)).not.toBeInTheDocument();
    });

    it('displays tagline below login card', () => {
        vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: false, discordConfigured: false },
            isLoading: false,
            error: null,
        } as any);

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/coordinate raids\. track attendance\. conquer together\./i)).toBeInTheDocument();
    });
});
