/**
 * ROK-2342 S2: a page that throws while rendering is caught inside the app shell —
 * the nav stays, the fallback offers Back / Reload, and navigating away recovers.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { RouteErrorBoundary } from './route-error-boundary';

function Boom(): never {
    throw new Error('render exploded');
}

function Shell({ entries = ['/boom'] }: { entries?: string[] }) {
    return (
        <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
            <nav aria-label="Main"><Link to="/ok">Go to ok</Link></nav>
            <RouteErrorBoundary>
                <Routes>
                    <Route path="/boom" element={<Boom />} />
                    <Route path="/ok" element={<p>Healthy page</p>} />
                    <Route path="/" element={<p>Home page</p>} />
                </Routes>
            </RouteErrorBoundary>
        </MemoryRouter>
    );
}

describe('RouteErrorBoundary', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        window.history.replaceState(null, '');
    });

    it('keeps the nav and shows the in-shell fallback with Back and Reload', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<Shell />);
        expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'This page hit a problem' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
        expect(screen.getByText('render exploded').closest('details')).not.toBeNull();
    });

    it('resets when the route changes', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<Shell />);
        fireEvent.click(screen.getByRole('link', { name: 'Go to ok' }));
        expect(screen.getByText('Healthy page')).toBeInTheDocument();
        expect(screen.queryByTestId('route-error')).not.toBeInTheDocument();
    });

    it('Back goes home when there is no in-app history (never off-site)', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        window.history.replaceState(null, '');
        render(<Shell entries={['/ok', '/boom']} />);
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Home page')).toBeInTheDocument();
    });

    it('Back goes to the previous in-app page when react-router has history', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        window.history.replaceState({ idx: 1 }, '');
        render(<Shell entries={['/ok', '/boom']} />);
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(screen.getByText('Healthy page')).toBeInTheDocument();
    });
});
