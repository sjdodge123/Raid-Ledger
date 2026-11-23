/**
 * TECH-DEBT L4009: a local sign-in must complete when the browser blocks Web
 * Storage (Safari private mode, blocked site data). The post-login welcome
 * check used to read/write localStorage unguarded, so the SecurityError was
 * caught by the login handler and shown as a failed sign-in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SystemStatusDto } from '@raid-ledger/contract';
import { LoginPage } from './login-page';
import { toast } from '../lib/toast';
import { blockWebStorage } from '../test/block-web-storage';

vi.mock('../hooks/use-auth', () => ({
    useAuth: () => ({
        login: vi.fn().mockResolvedValue({ role: 'member', onboardingCompletedAt: '2026-01-01T00:00:00Z' }),
    }),
}));
vi.mock('../hooks/use-system-status', () => {
    const data: SystemStatusDto = {
        isFirstRun: true,
        discordConfigured: false,
        blizzardConfigured: false,
        steamConfigured: false,
        activePlugins: [],
        authProviders: [],
    };
    return { useSystemStatus: () => ({ data }) };
});
vi.mock('../lib/api/native-fetch', () => ({
    nativeFetch: vi.fn(() => Promise.resolve(
        new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
    )),
}));
// auth-redirect has its own sessionStorage reads; isolate the login page's own.
vi.mock('../components/auth', () => ({ consumeAuthRedirect: () => null }));
vi.mock('../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

function renderLogin(): void {
    render(
        <MemoryRouter initialEntries={['/login']}>
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/calendar" element={<p>calendar page</p>} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('LoginPage — browser blocks storage (TECH-DEBT L4009)', () => {
    let restore: () => void = () => undefined;
    beforeEach(() => {
        vi.clearAllMocks();
        restore = blockWebStorage();
    });
    afterEach(() => restore());

    it('signs in and lands on the calendar instead of reporting a failed login', async () => {
        renderLogin();
        fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

        // The success toast fires before the post-login redirect logic runs.
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Logged in successfully!'));
        expect(toast.error, 'a blocked storage read must not surface as a failed login').not.toHaveBeenCalled();
        expect(await screen.findByText('calendar page')).toBeInTheDocument();
    });
});
