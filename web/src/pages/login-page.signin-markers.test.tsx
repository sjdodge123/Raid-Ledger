/**
 * ROK-2370: the login page's own sign-in paths write the "Last used" marker —
 * username/password records 'password'; an approved Discord-app code records
 * 'discord-app-code' once the "Signed in as …" hold hands over.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import type { SystemStatusDto } from '@raid-ledger/contract';
import * as useSystemStatusModule from '../hooks/use-system-status';
import { LAST_SIGNIN_KEY } from '../lib/last-signin';
import { pollSigninCode } from '../lib/signin-code';
import { LoginPage } from './login-page';

const USER = {
    id: 3, username: 'raider3', displayName: 'Raider Three', avatar: null, customAvatarUrl: null,
    discordId: 'd-3', role: 'member', onboardingCompletedAt: '2026-01-01T00:00:00Z',
};
const login = vi.hoisted(() => vi.fn());
vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ login, logout: vi.fn() }) }));
vi.mock('../hooks/use-system-status');
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../lib/api/native-fetch', () => ({
    nativeFetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'local.jwt' }), { status: 200 })),
}));
vi.mock('../lib/signin-code', async (importActual) => ({
    ...(await importActual<typeof import('../lib/signin-code')>()),
    startSigninCode: vi.fn().mockResolvedValue({
        code: 'K7QD-2M9X', deviceSecret: 's'.repeat(43), expiresAt: '2099-01-01T00:00:00.000Z', pollIntervalMs: 2000,
    }),
    pollSigninCode: vi.fn(),
}));

function mockStatus(data: Partial<SystemStatusDto>): void {
    const base: SystemStatusDto = {
        isFirstRun: false, discordConfigured: false, blizzardConfigured: false,
        steamConfigured: false, activePlugins: [], authProviders: [],
    };
    vi.spyOn(useSystemStatusModule, 'useSystemStatus').mockReturnValue({
        data: { ...base, ...data }, isLoading: false, error: null, isError: false,
        isPending: false, isSuccess: true, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useSystemStatusModule.useSystemStatus>);
}

function markerMethod(): unknown {
    const raw = localStorage.getItem(LAST_SIGNIN_KEY);
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>).method;
}

const discordProvider = { key: 'discord', label: 'Continue with Discord', icon: 'discord', loginPath: '/auth/discord' };

describe('LoginPage — ROK-2370 last-used marker writes', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        vi.clearAllMocks();
        login.mockResolvedValue(USER);
    });

    it('a username/password sign-in records the password method', async () => {
        mockStatus({ authProviders: [] });
        render(<BrowserRouter><LoginPage /></BrowserRouter>);
        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'raider3' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter22' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

        await waitFor(() => expect(markerMethod(), 'password sign-in must write the marker').toBe('password'));
    });

    it('an approved Discord-app code records the discord-app-code method', async () => {
        vi.mocked(pollSigninCode).mockResolvedValue({
            status: 'approved', session: { access_token: 'code.jwt' },
        } as Awaited<ReturnType<typeof pollSigninCode>>);
        mockStatus({ discordSigninCode: true, authProviders: [discordProvider] });
        render(<BrowserRouter><LoginPage /></BrowserRouter>);
        fireEvent.click(screen.getByRole('button', { name: 'Sign in not working? Try another way' }));

        await waitFor(() => expect(markerMethod(), 'code sign-in must write the marker').toBe('discord-app-code'),
            { timeout: 4000 });
    });
});
