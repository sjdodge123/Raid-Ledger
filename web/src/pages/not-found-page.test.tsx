/**
 * ROK-2319: the route tree has a catch-all, so an unknown URL renders the shared
 * not-found page (heading + a link home) instead of an empty main area.
 */
import { Suspense } from 'react';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render-helpers';
import { AppRoutes } from '../app-routes';
import { NOT_FOUND_TITLE } from './not-found-page';

function renderAt(path: string) {
    return renderWithProviders(<Suspense fallback={null}><AppRoutes /></Suspense>, { initialEntries: [path] });
}

describe('catch-all route', () => {
    it.each(['/this-does-not-exist', '/event/123'])('renders the not-found page for %s', async (path) => {
        renderAt(path);
        expect(await screen.findByRole('heading', { name: NOT_FOUND_TITLE })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
    });
});
