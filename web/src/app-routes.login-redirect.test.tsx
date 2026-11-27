/**
 * ROK-2371 (Codex P2): Discord and Google sign-in refusals land on
 * `/login?error=…&reason=…`. The `/login` → `/` redirect must keep that
 * query, or the login page never sees the refusal and the user sees nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./components/RootRedirect', async () => {
    const { useLocation } = await import('react-router-dom');
    return {
        RootRedirect: () => {
            const { pathname, search } = useLocation();
            return <div data-testid="root-location">{`${pathname}${search}`}</div>;
        },
    };
});

import { AppRoutes } from './app-routes';

describe('AppRoutes — /login keeps the sign-in refusal query (ROK-2371)', () => {
    it.each([
        '?error=suspended&reason=Your+account+has+been+suspended%3A+Spamming',
        '?error=deactivated&reason=Rejoin',
        '?error=google_unverified',
    ])('redirects /login%s to / with the same query', async (search) => {
        render(
            <MemoryRouter initialEntries={[`/login${search}`]}>
                <AppRoutes />
            </MemoryRouter>,
        );
        expect(await screen.findByTestId('root-location')).toHaveTextContent(`/${search}`);
    });
});
