/**
 * ROK-2319: the route tree has a catch-all, so an unknown URL renders the shared
 * not-found page (heading + a link home) instead of an empty main area. Known routes,
 * public and signed-in, must still reach their own element — the splat ranks last.
 */
import { Suspense } from 'react';
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render-helpers';
import { AppRoutes } from '../app-routes';
import { consumeAuthRedirect } from '../lib/auth-redirect';
import { NOT_FOUND_TITLE } from './not-found-page';

function renderAt(path: string) {
    return renderWithProviders(<Suspense fallback={null}><AppRoutes /></Suspense>, { initialEntries: [path] });
}

describe('catch-all route', () => {
    it.each(['/this-does-not-exist', '/event/123', '/profile/nope', '/admin/settings/nope'])(
        'renders the not-found page for %s',
        async (path) => {
            renderAt(path);
            expect(await screen.findByRole('heading', { name: NOT_FOUND_TITLE })).toBeInTheDocument();
            expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
        },
    );

    it('does not shadow a known public route: /privacy renders the privacy policy', async () => {
        renderAt('/privacy');
        // Whichever page wins draws an h1; it must be the policy's, not the not-found heading.
        const h1 = await screen.findByRole('heading', { level: 1 });
        expect(h1).not.toHaveTextContent(NOT_FOUND_TITLE);
        expect(screen.getByTestId('privacy-policy')).toContainElement(h1);
    });

    it('does not shadow a signed-in route: /calendar goes through the auth guard, not the not-found page', async () => {
        consumeAuthRedirect();
        renderAt('/calendar');
        // The guard (signed out) remembers the URL for after sign-in; the catch-all never would.
        await waitFor(() => expect(consumeAuthRedirect()).toBe('/calendar'));
        expect(screen.queryByRole('heading', { name: NOT_FOUND_TITLE })).not.toBeInTheDocument();
    });
});
