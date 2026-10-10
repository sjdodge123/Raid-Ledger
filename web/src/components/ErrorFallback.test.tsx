/**
 * ROK-1763: the top-level boundary's fallback must show the "new version"
 * state for WebKit's failed-import error, not the generic crash screen.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorFallback } from './ErrorFallback';

describe('ErrorFallback', () => {
    it('shows "New Version Available" for the WebKit stale-chunk error', () => {
        render(<ErrorFallback error={new TypeError('Importing a module script failed.')} />);
        expect(screen.getByRole('heading', { name: 'New Version Available' })).toBeInTheDocument();
        expect(screen.queryByText('Importing a module script failed.')).not.toBeInTheDocument();
    });

    it('shows "New Version Available" for the Chrome stale-chunk error', () => {
        render(<ErrorFallback error={new TypeError('Failed to fetch dynamically imported module: https://x/a.js')} />);
        expect(screen.getByRole('heading', { name: 'New Version Available' })).toBeInTheDocument();
    });

    it('shows the generic state and the message for an unrelated error', () => {
        render(<ErrorFallback error={new Error('boom')} />);
        expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
        expect(screen.getByText('boom')).toBeInTheDocument();
    });
});
