/**
 * ROK-2291: the phone sign-in hint on the login card — shown below 1024px
 * when Discord sign-in is offered and it is not first run, nowhere else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type { SystemStatusDto } from '@raid-ledger/contract';
import { LoginPage } from './login-page';
import * as useSystemStatusModule from '../hooks/use-system-status';
import { useMediaQuery } from '../hooks/use-media-query';
import { PHONE_MQ } from '../lib/breakpoints';

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ login: vi.fn() }) }));
vi.mock('../hooks/use-system-status');
vi.mock('../hooks/use-media-query', () => ({ useMediaQuery: vi.fn() }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const HINT_COPY = 'On a phone? Sign in once and this browser keeps you signed in. '
    + 'No Discord password handy? Type /login in our Discord server for a sign-in link.';

const discordProvider = { key: 'discord', label: 'Continue with Discord', icon: 'discord', loginPath: '/auth/discord' };

function mockSystemStatus(data: Partial<SystemStatusDto>): void {
    const defaults: SystemStatusDto = {
        isFirstRun: false, discordConfigured: true, blizzardConfigured: false,
        steamConfigured: false, activePlugins: [], authProviders: [discordProvider],
    };
    vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
        data: { ...defaults, ...data }, isLoading: false, error: null, isError: false,
        isPending: false, isSuccess: true, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSystemStatusModule.useSystemStatus>);
}

function setPhone(isPhone: boolean): void {
    vi.mocked(useMediaQuery).mockImplementation((query) => (query === PHONE_MQ ? isPhone : false));
}

function renderPage(): void {
    render(<BrowserRouter><LoginPage /></BrowserRouter>);
}

describe('LoginPage phone sign-in hint (ROK-2291)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the exact copy between the Discord button and the username toggle on a phone', () => {
        setPhone(true);
        mockSystemStatus({});
        renderPage();
        const hint = screen.getByRole('note');
        expect(hint.textContent).toBe(HINT_COPY);
        const discord = screen.getByRole('button', { name: /continue with discord/i });
        const toggle = screen.getByRole('button', { name: 'Sign in with username instead' });
        expect(discord.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(hint.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('puts /login in a code element', () => {
        setPhone(true);
        mockSystemStatus({});
        renderPage();
        expect(screen.getByText('/login').tagName).toBe('CODE');
    });

    it('is not rendered at 1024px and wider', () => {
        setPhone(false);
        mockSystemStatus({});
        renderPage();
        expect(screen.queryByRole('note')).toBeNull();
        expect(screen.getByRole('button', { name: /continue with discord/i })).toBeInTheDocument();
    });

    it('is not rendered when Discord sign-in is not offered', () => {
        setPhone(true);
        mockSystemStatus({ authProviders: [] });
        renderPage();
        expect(screen.queryByText(/On a phone\?/)).toBeNull();
    });

    it('is not rendered on first run, where the first-run callout shows instead', () => {
        setPhone(true);
        mockSystemStatus({ isFirstRun: true });
        renderPage();
        expect(screen.queryByText(/On a phone\?/)).toBeNull();
        expect(screen.getByText(/First time\? Your admin credentials/)).toBeInTheDocument();
    });
});
