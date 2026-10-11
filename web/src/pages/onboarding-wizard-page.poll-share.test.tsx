/**
 * ROK-1750 (D5) — a brand-new user who opened a private poll's share link ends
 * on that link after onboarding (Skip All / Complete), not /calendar; a
 * pending `invite_code` still wins; the token is cleared once used.
 * Harness mirrors `onboarding-wizard-page.invite-claim.test.tsx`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { User } from '../hooks/use-auth';
import { OnboardingWizardPage } from './onboarding-wizard-page';

const mockFetchApi = vi.fn();
vi.mock('../lib/api-client', () => ({ fetchApi: (...args: unknown[]) => mockFetchApi(...args) }));
vi.mock('../hooks/use-auth', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    return {
        useAuth: () => ({
            user: useQuery<User | null>({
                queryKey: ['auth', 'me'], queryFn: () => new Promise<User>(() => {}), staleTime: Infinity,
            }).data ?? null,
        }),
        isAdmin: () => false,
    };
});
vi.mock('./onboarding-wizard/use-conditional-step-flags', () => ({
    useConditionalStepFlags: () => ({ needsConnect: false, needsDiscordJoin: false, needsSteamConnect: false, settled: true }),
}));
vi.mock('./onboarding-wizard/OnboardingBreadcrumbs', () => ({ OnboardingBreadcrumbs: () => null }));
vi.mock('../hooks/use-game-registry', () => ({ useGameRegistry: () => ({ games: [] }) }));
vi.mock('../hooks/use-user-profile', () => ({ useUserHeartedGames: () => ({ data: undefined }) }));
vi.mock('../lib/toast', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../components/onboarding/connect-step', () => ({ ConnectStep: () => null }));
vi.mock('../components/onboarding/steam-step', () => ({ SteamStep: () => null }));
vi.mock('../components/onboarding/discord-join-step', () => ({ DiscordJoinStep: () => null }));
vi.mock('../components/onboarding/games-step', () => ({ GamesStep: () => null }));
vi.mock('../components/onboarding/character-step', () => ({ CharacterStep: () => null }));
vi.mock('../components/onboarding/gametime-step', () => ({ GameTimeStep: () => null }));
vi.mock('../components/onboarding/connection-step', () => ({ ConnectionStep: () => null }));
vi.mock('../components/onboarding/avatar-theme-step', () => ({ AvatarThemeStep: () => null }));

const newUser: User = {
    id: 7, discordId: 'd-7', username: 'newbie', displayName: null, avatar: null,
    customAvatarUrl: null, role: 'member', steamId: null, onboardingCompletedAt: null,
};

function LocationProbe(): JSX.Element {
    const { pathname, search } = useLocation();
    return <output data-testid="location">{pathname + search}</output>;
}

function renderWizard(): void {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], newUser);
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/onboarding']}>
                <LocationProbe />
                <Routes>
                    <Route path="/onboarding" element={<OnboardingWizardPage />} />
                    <Route path="*" element={<p>Elsewhere</p>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

const location = () => screen.getByTestId('location');

describe('OnboardingWizardPage — pending poll share token (ROK-1750 D5)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetchApi.mockResolvedValue({ success: true, onboardingCompletedAt: '2026-10-10T12:00:00.000Z' });
    });
    afterEach(() => sessionStorage.clear());

    it('Skip All ends on the poll share link, not /calendar, and clears the token', async () => {
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        renderWizard();
        fireEvent.click(screen.getByRole('button', { name: 'Skip All' }));
        await waitFor(() => expect(location()).toHaveTextContent('/p/poll/tok_abc'));
        expect(sessionStorage.getItem('poll_share_token')).toBeNull();
    });

    it('Complete ends on the poll share link, not /calendar', async () => {
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        renderWizard();
        for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
        await waitFor(() => expect(location()).toHaveTextContent('/p/poll/tok_abc'));
    });

    it('a pending invite_code still wins over the poll token', async () => {
        sessionStorage.setItem('invite_code', 'ABC123');
        sessionStorage.setItem('poll_share_token', 'tok_abc');
        renderWizard();
        fireEvent.click(screen.getByRole('button', { name: 'Skip All' }));
        await waitFor(() => expect(location()).toHaveTextContent('/i/ABC123?claim=1'));
    });

    it('with nothing pending it still ends on /calendar', async () => {
        renderWizard();
        fireEvent.click(screen.getByRole('button', { name: 'Skip All' }));
        await waitFor(() => expect(location()).toHaveTextContent('/calendar'));
    });
});
