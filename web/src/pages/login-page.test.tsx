import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, useLocation } from 'react-router-dom';
import { LoginPage } from './login-page';
import * as useSystemStatusModule from '../hooks/use-system-status';
import { toast } from '../lib/toast';
import type { SystemStatusDto } from '@raid-ledger/contract';

// Mock the hooks
vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({
        login: vi.fn(),
    }),
}));

vi.mock('../hooks/use-system-status');
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/signin-code', async (importActual) => ({
    ...(await importActual<typeof import('../lib/signin-code')>()),
    startSigninCode: vi.fn().mockResolvedValue({
        code: 'K7QD-2M9X', deviceSecret: 's'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z', pollIntervalMs: 2000,
    }),
    pollSigninCode: vi.fn().mockResolvedValue({ status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' }),
}));

const TRY_ANOTHER_WAY = 'Sign in not working? Try another way';

// Type-safe mock helper
function mockSystemStatus(data: Partial<SystemStatusDto>) {
    const defaults: SystemStatusDto = {
        isFirstRun: false,
        discordConfigured: false,
        blizzardConfigured: false,
        steamConfigured: false,
        activePlugins: [],
        authProviders: [],
    };
    vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
        data: { ...defaults, ...data },
        isLoading: false,
        error: null,
        isError: false,
        isPending: false,
        isSuccess: true,
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSystemStatusModule.useSystemStatus>);
}

const discordProvider = {
    key: 'discord',
    label: 'Continue with Discord',
    icon: 'discord',
    loginPath: '/auth/discord',
};

// Wrapper for router context
const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('LoginPage — part 1', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders login form with username field when no auth providers configured', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [] });

        renderWithRouter(<LoginPage />);

        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('hides Discord button when no auth providers configured', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [] });

        renderWithRouter(<LoginPage />);

        expect(screen.queryByText(/continue with discord/i)).not.toBeInTheDocument();
    });

    it('shows Discord button when Discord auth provider is configured', () => {
        mockSystemStatus({
            isFirstRun: false,
            discordConfigured: true,
            authProviders: [discordProvider],
        });

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/continue with discord/i)).toBeInTheDocument();
    });

    it('hides local login form by default when auth providers are configured', () => {
        mockSystemStatus({
            isFirstRun: false,
            discordConfigured: true,
            authProviders: [discordProvider],
        });

        renderWithRouter(<LoginPage />);

        expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: TRY_ANOTHER_WAY })).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows local login form when toggle is clicked', () => {
        mockSystemStatus({
            isFirstRun: false,
            discordConfigured: true,
            authProviders: [discordProvider],
        });

        renderWithRouter(<LoginPage />);

        fireEvent.click(screen.getByRole('button', { name: TRY_ANOTHER_WAY }));

        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: TRY_ANOTHER_WAY })).toHaveAttribute('aria-expanded', 'true');
    });

});

describe('LoginPage — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('auto-expands local login on first run with auth providers configured', () => {
        mockSystemStatus({
            isFirstRun: true,
            discordConfigured: true,
            authProviders: [discordProvider],
        });

        renderWithRouter(<LoginPage />);

        // Both auth provider and local login should be visible — first run opens the disclosure on password
        expect(screen.getByText(/continue with discord/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('first run opens on the password section even when the code path is offered (ROK-2370)', () => {
        mockSystemStatus({ isFirstRun: true, discordSigninCode: true, authProviders: [discordProvider] });

        renderWithRouter(<LoginPage />);

        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(screen.queryByTestId('signin-code-waiting')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Get a code to confirm in Discord' })).toBeInTheDocument();
    });

    it('opens on the Discord-app code, then password, when discordSigninCode is on (ROK-2370)', async () => {
        sessionStorage.clear();
        mockSystemStatus({ isFirstRun: false, discordSigninCode: true, authProviders: [discordProvider] });

        renderWithRouter(<LoginPage />);
        expect(screen.queryByRole('note')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: TRY_ANOTHER_WAY }));

        expect(await screen.findByTestId('signin-code-value')).toHaveTextContent('K7QD-2M9X');
        expect(screen.getByText(/In Discord, type/)).toHaveTextContent(
            'In Discord, type /login code:K7QD-2M9X and tap Yes, sign me in. Then come back to this browser.');
        expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Sign in with username' })).toBeInTheDocument();
    });

    it('offers no code section when discordSigninCode is off (ROK-2370)', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [discordProvider] });

        renderWithRouter(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: TRY_ANOTHER_WAY }));

        expect(screen.queryByRole('button', { name: 'Get a code to confirm in Discord' })).not.toBeInTheDocument();
        expect(screen.queryByText(/get a code and confirm it in Discord/)).not.toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('displays community name from env variable', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [] });

        renderWithRouter(<LoginPage />);

        // Default community name when VITE_COMMUNITY_NAME is not set
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/raid\s*ledger/i);
    });

    it('shows first-run hint when isFirstRun is true', () => {
        mockSystemStatus({ isFirstRun: true, authProviders: [] });

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/first time/i)).toBeInTheDocument();
        expect(screen.getByText(/container logs/i)).toBeInTheDocument();
    });

    it('hides first-run hint when isFirstRun is false', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [] });

        renderWithRouter(<LoginPage />);

        expect(screen.queryByText(/first time/i)).not.toBeInTheDocument();
    });

    it('displays tagline below login card', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [] });

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/coordinate raids\. track attendance\. conquer together\./i)).toBeInTheDocument();
    });

    it('renders multiple auth providers when configured (ROK-267)', () => {
        const secondProvider = {
            key: 'github',
            label: 'Continue with GitHub',
            icon: 'github',
            loginPath: '/auth/github',
        };
        mockSystemStatus({
            isFirstRun: false,
            authProviders: [discordProvider, secondProvider],
        });

        renderWithRouter(<LoginPage />);

        expect(screen.getByText(/continue with discord/i)).toBeInTheDocument();
        expect(screen.getByText(/continue with github/i)).toBeInTheDocument();
    });

});

describe('LoginPage on the form primitives (ROK-1648)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('paints each provider button with its brand colour through Button brandColor', () => {
        const github = { ...discordProvider, key: 'github', label: 'Continue with GitHub', icon: 'github', color: '#24292F' };
        mockSystemStatus({ isFirstRun: false, authProviders: [discordProvider, github] });

        renderWithRouter(<LoginPage />);

        const discord = screen.getByRole('button', { name: 'Continue with Discord' });
        expect(discord).toHaveAttribute('data-brand-fill');
        expect(discord).toHaveStyle({ backgroundColor: '#5865F2' });
        expect(discord.className).not.toMatch(/ring-offset-slate/);
        const gh = screen.getByRole('button', { name: 'Continue with GitHub' });
        expect(gh).toHaveAttribute('data-brand-fill');
        expect(gh).toHaveStyle({ backgroundColor: '#24292F' });
        // ROK-1472: the label is chosen by contrast — white on both of these dark fills.
        expect(discord).toHaveAttribute('data-brand-label', 'light');
        expect(gh).toHaveAttribute('data-brand-label', 'light');
    });

    it('marks the provider button busy + aria-disabled while redirecting', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [discordProvider] });

        renderWithRouter(<LoginPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Discord' }));

        const busy = screen.getByRole('button', { name: 'Redirecting...' });
        expect(busy).toHaveAttribute('aria-busy', 'true');
        expect(busy).toHaveAttribute('aria-disabled', 'true');
    });

    it('renders the "Try another way" trigger as a non-submitting ghost Button', () => {
        mockSystemStatus({ isFirstRun: false, authProviders: [discordProvider] });

        renderWithRouter(<LoginPage />);

        const toggle = screen.getByRole('button', { name: TRY_ANOTHER_WAY });
        expect(toggle).toHaveAttribute('type', 'button');
        // Button wraps its label in a [data-button-label] span; a raw <button> does not.
        expect(toggle.querySelector('[data-button-label]'), 'toggle is the shared Button (has a data-button-label span)').not.toBeNull();
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(document.querySelector('#username')).not.toBeNull();
    });
});

// ROK-313 AC4: the Discord OAuth ban/kick path redirects to
// /login?error=suspended&reason=<enc>; the SPA must surface the reason and
// scrub both query params. Shared by the ban and kick cooldown flows.
function LocationProbe() {
    const location = useLocation();
    return <div data-testid="search">{location.search}</div>;
}

function renderSuspended(search: string) {
    mockSystemStatus({ isFirstRun: false, authProviders: [] });
    return render(
        <MemoryRouter initialEntries={[`/login${search}`]}>
            <LoginPage />
            <LocationProbe />
        </MemoryRouter>,
    );
}

describe('LoginPage — suspended OAuth error (ROK-313 AC4)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('toasts the provided reason and clears both error and reason params', async () => {
        renderSuspended('?error=suspended&reason=Banned%20for%20cheating');

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Banned for cheating'));
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
        const search = screen.getByTestId('search').textContent ?? '';
        expect(search).not.toContain('error');
        expect(search).not.toContain('reason');
    });

    it('falls back to default copy when no reason is provided', async () => {
        renderSuspended('?error=suspended');

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Your account has been suspended.'));
        const search = screen.getByTestId('search').textContent ?? '';
        expect(search).not.toContain('error');
    });

    it('does not toast a suspension when there is no error param', () => {
        renderSuspended('');
        expect(toast.error).not.toHaveBeenCalled();
    });
});

describe('LoginPage — first-run hint tokens (ROK-1648 ruling 9)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('paints the first-run hint as a neutral panel, not a raw blue callout (ruling 9)', () => {
        mockSystemStatus({ isFirstRun: true, authProviders: [] });
        renderWithRouter(<LoginPage />);
        const text = screen.getByText(/container logs/i);
        const panel = text.parentElement!;
        expect(panel.className, 'the hint should wear the neutral bg-overlay/30 panel').toContain('bg-overlay/30');
        expect(panel.className, 'the hint border should be the edge token').toContain('border-edge');
        expect(`${panel.className} ${text.className}`, 'the hint must not hardcode a blue/indigo/purple/violet hue')
            .not.toMatch(/(blue|indigo|purple|violet)-\d/);
    });
});

describe('LoginPage — deactivated session notice (ROK-1753)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('toasts the deactivated copy and clears the error param', async () => {
        renderSuspended('?error=deactivated');

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Your account was deactivated when you left the Discord server. Rejoin it, then sign in with Discord.'));
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    });
});

// ROK-2371 §3: Google sign-in refusals share the Discord params. Banned and
// kicked ride `suspended` + the server copy; deactivated always shows the
// fixed Google copy (a crafted `reason` is ignored); unverified has its own code.
describe('LoginPage — Google sign-in refusals (ROK-2371)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const GOOGLE_DEACTIVATED =
        'Your account was deactivated when you left the Discord server. Rejoin it, then sign in with Discord.';

    it.each([
        ['banned', 'error=suspended&reason=Your%20account%20has%20been%20suspended%3A%20Spamming', 'Your account has been suspended: Spamming'],
        [
            'kicked',
            'error=suspended&reason=Your%20session%20was%20ended%20by%20an%20administrator.%20You%20may%20log%20in%20again%20in%205%20minute(s).',
            'Your session was ended by an administrator. You may log in again in 5 minute(s).',
        ],
        ['deactivated', `error=deactivated&reason=${encodeURIComponent(GOOGLE_DEACTIVATED)}`, GOOGLE_DEACTIVATED],
        ['deactivated with a crafted reason', 'error=deactivated&reason=Visit%20evil.example', GOOGLE_DEACTIVATED],
        ['unverified', 'error=google_unverified', 'Google has not verified the email on that account, so it cannot be used to sign in.'],
    ])('%s: toasts the refusal copy and scrubs error + reason', async (_label, query, copy) => {
        renderSuspended(`?${query}`);

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy));
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
        expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it('ignores an error code that is not a sign-in refusal', () => {
        renderSuspended('?error=something_else');
        expect(toast.error).not.toHaveBeenCalled();
    });
});
