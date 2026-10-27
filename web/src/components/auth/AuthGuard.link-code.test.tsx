import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { consumeAuthRedirect } from '../../lib/auth-redirect';

vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn(), isAdmin: () => false }));

import { useAuth } from '../../hooks/use-auth';

const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

/** Shows the router location so the test can read the restored fragment. */
function LinkProbe(): JSX.Element {
    const { hash } = useLocation();
    return <div>link page {hash}</div>;
}

/** Render the guard at `route` with a stand-in login page and `/link` page. */
async function renderGuard(route: string): Promise<void> {
    const { AuthGuard } = await import('./AuthGuard');
    render(
        <MemoryRouter initialEntries={[route]}>
            <Routes>
                <Route path="/" element={<div>Login Page</div>} />
                <Route element={<AuthGuard />}>
                    <Route path="/link" element={<LinkProbe />} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

/** ROK-1955 review: a signed-out `/link#code=…` visit keeps its code through sign-in. */
describe('AuthGuard — captured companion link code', () => {
    afterEach(() => {
        sessionStorage.clear();
        window.history.replaceState(null, '', '/');
    });

    it('saves /link#code=<code> (fragment) as the return path for a signed-out visitor', async () => {
        window.history.replaceState(null, '', '/link#code=BCDF-GHJK');
        vi.resetModules();
        mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false, isLoading: false });
        await renderGuard('/link');
        expect(screen.getByText('Login Page')).toBeInTheDocument();
        expect(window.location.href).not.toContain('BCDF');
        expect(consumeAuthRedirect()).toBe('/link#code=BCDF-GHJK');
    });

    it('saves a plain /link when no code was captured', async () => {
        window.history.replaceState(null, '', '/link');
        vi.resetModules();
        mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false, isLoading: false });
        await renderGuard('/link');
        expect(consumeAuthRedirect()).toBe('/link');
    });
});
