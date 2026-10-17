/**
 * TDB:982 follow-up — Complete / Skip All with a pending invite must land on the
 * invite claim (`/i/<code>?claim=1`), never on /calendar.
 *
 * The auth/me cache patch (use-onboarding-fte) makes the wizard's own
 * completed-user redirect true. query-core delivers that patch on a
 * setTimeout(0) queued BEFORE the per-call navigate; the router commits its
 * location in a transition. If the timer wins, the wizard re-renders at
 * /onboarding and its `<Navigate to="/calendar">` replaces the invite claim —
 * and `invite_code` is already gone from sessionStorage, so the claim is lost.
 *
 * TDB:1993 — a failed Complete / Skip All must say so and keep the user on the
 * wizard, and Skip All must not be clickable again while its request is in flight.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { CompleteOnboardingResponseDto } from '@raid-ledger/contract';
import type { User } from '../hooks/use-auth';
import { toast } from '../lib/toast';
import { OnboardingWizardPage } from './onboarding-wizard-page';

const mockFetchApi = vi.fn();
vi.mock('../lib/api-client', () => ({ fetchApi: (...args: unknown[]) => mockFetchApi(...args) }));

vi.mock('../hooks/use-auth', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    return {
        // Reads the cached auth/me user like AuthGuard does; its refetch never lands.
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

const COMPLETED_AT = '2026-09-29T12:00:00.000Z';
const INVITE_CLAIM = '/i/ABC123?claim=1';

const newUser: User = {
    id: 7, discordId: 'd-7', username: 'newbie', displayName: null, avatar: null,
    customAvatarUrl: null, role: 'member', steamId: null, onboardingCompletedAt: null,
};

function LocationProbe(): JSX.Element {
    const { pathname, search } = useLocation();
    return <output data-testid="location">{pathname + search}</output>;
}

function renderWizard(): QueryClient {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['auth', 'me'], newUser);
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/onboarding']}>
                <LocationProbe />
                <Routes>
                    <Route path="/onboarding" element={<OnboardingWizardPage />} />
                    <Route path="/calendar" element={<p>Calendar</p>} />
                    <Route path="/i/:code" element={<p>Invite claim</p>} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return client;
}

/**
 * Clicks `control`, then lands the complete-onboarding response inside ONE act
 * scope held open until the per-call navigate has run (it clears invite_code)
 * AND query-core's notify timer — queued by the cache patch before that
 * navigate — has fired. Both updates are then pending when React flushes, and
 * React renders the synchronous store update before the router's transition:
 * the browser order where the timer beats the location commit.
 */
async function completeWithNotifyTimerFirst(control: HTMLElement): Promise<void> {
    let land!: (value: CompleteOnboardingResponseDto) => void;
    mockFetchApi.mockReturnValue(new Promise<CompleteOnboardingResponseDto>((resolve) => { land = resolve; }));
    fireEvent.click(control);
    await act(async () => {
        land({ success: true, onboardingCompletedAt: COMPLETED_AT } as CompleteOnboardingResponseDto);
        await vi.waitUntil(() => sessionStorage.getItem('invite_code') === null);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

describe('OnboardingWizardPage — invite claim survives completion (TDB:982)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.setItem('invite_code', 'ABC123');
    });
    afterEach(() => sessionStorage.clear());

    it('Complete ends on the invite claim, not /calendar', async () => {
        renderWizard();
        for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        await completeWithNotifyTimerFirst(screen.getByRole('button', { name: 'Complete' }));

        expect(
            screen.getByTestId('location').textContent,
            "the wizard's completed-user redirect must not replace the invite claim",
        ).toBe(INVITE_CLAIM);
    });

    it('Skip All ends on the invite claim, not /calendar', async () => {
        renderWizard();

        await completeWithNotifyTimerFirst(screen.getByRole('button', { name: 'Skip All' }));

        expect(
            screen.getByTestId('location').textContent,
            "the wizard's completed-user redirect must not replace the invite claim",
        ).toBe(INVITE_CLAIM);
    });

    it('Escape while Complete is pending neither re-POSTs nor replaces the Complete navigation', async () => {
        renderWizard();
        for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        let land!: (value: CompleteOnboardingResponseDto) => void;
        mockFetchApi.mockReturnValue(new Promise<CompleteOnboardingResponseDto>((resolve) => { land = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
        await screen.findByRole('button', { name: 'Completing...' });

        fireEvent.keyDown(window, { key: 'Escape' });
        await act(async () => {});
        const completePosts = mockFetchApi.mock.calls.filter(([url]) => url === '/users/me/complete-onboarding');
        expect(completePosts.length, 'Escape during a pending Complete must not fire a second complete POST').toBe(1);

        await act(async () => { land({ success: true, onboardingCompletedAt: COMPLETED_AT } as CompleteOnboardingResponseDto); });
        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(INVITE_CLAIM));
        expect(toast.info, 'Complete must not be reported as a skip').not.toHaveBeenCalled();
    });
});

const COMPLETE_URL = '/users/me/complete-onboarding';
const completePosts = (): unknown[][] => mockFetchApi.mock.calls.filter(([url]) => url === COMPLETE_URL);

/**
 * Lets the clicked mutation reach `until` (its POST sent, or settled), then
 * flushes query-core's batched setTimeout(0) listener notify into React.
 */
async function settle(until: () => boolean): Promise<void> {
    await act(async () => {
        await vi.waitUntil(until);
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

describe('OnboardingWizardPage — Complete / Skip All in flight and failing (TDB:1993)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.setItem('invite_code', 'ABC123');
    });
    afterEach(() => sessionStorage.clear());

    it('Skip All is disabled and reads "Skipping…" while its request is in flight', async () => {
        renderWizard();
        mockFetchApi.mockReturnValue(new Promise<CompleteOnboardingResponseDto>(() => {}));
        fireEvent.click(screen.getByRole('button', { name: 'Skip All' }));
        await settle(() => completePosts().length === 1);

        const skipAll = screen.getByRole('button', { name: /skip all|skipping/i });
        expect(skipAll, 'the in-flight Skip All must name its state').toHaveAccessibleName(/skipping/i);
        expect(skipAll, 'the in-flight Skip All must not be clickable').toBeDisabled();
        expect(skipAll).toHaveAttribute('aria-busy', 'true');

        fireEvent.click(skipAll);
        await act(async () => {});
        expect(completePosts().length, 'a second Skip All click must not send a second complete POST').toBe(1);
    });

    it('a failed Skip All shows an error, stays on the wizard and keeps the pending invite', async () => {
        const client = renderWizard();
        mockFetchApi.mockRejectedValue(new Error('Network down'));
        fireEvent.click(screen.getByRole('button', { name: 'Skip All' }));
        await settle(() => client.isMutating() === 0);

        expect(toast.error, 'a failed Skip All must tell the user').toHaveBeenCalledTimes(1);
        expect(toast.error).toHaveBeenCalledWith(
            'Could not finish setup. Please try again.', { id: 'onboarding-complete-error' },
        );
        expect(toast.info, 'a failed Skip All must not be reported as skipped').not.toHaveBeenCalled();
        expect(screen.getByTestId('location').textContent).toBe('/onboarding');
        expect(sessionStorage.getItem('invite_code'), 'the pending invite must survive a failure').toBe('ABC123');
        expect(screen.getByRole('button', { name: 'Skip All' }), 'Skip All must be retryable').toBeEnabled();
    });

    it('a failed Complete shows an error and stays on the final step', async () => {
        const client = renderWizard();
        for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        mockFetchApi.mockRejectedValue(new Error('Network down'));
        fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
        await settle(() => client.isMutating() === 0);

        expect(toast.error, 'a failed Complete must tell the user').toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('location').textContent).toBe('/onboarding');
        expect(sessionStorage.getItem('invite_code')).toBe('ABC123');
        expect(screen.getByRole('button', { name: 'Complete' }), 'Complete must be retryable').toBeEnabled();
    });
});
