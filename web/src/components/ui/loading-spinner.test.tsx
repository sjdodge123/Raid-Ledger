/**
 * LoadingSpinner must carry an accessible name: Playwright's error-context
 * aria snapshot drops data-testid, so an unnamed div renders as an anonymous
 * `generic` and a pending route chunk is indistinguishable from other loaders.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from './loading-spinner';

describe('LoadingSpinner', () => {
    it('is a named status region that keeps its test id', () => {
        render(<LoadingSpinner />);

        const spinner = screen.getByRole('status', { name: 'Loading page' });
        expect(spinner).toHaveAttribute('data-testid', 'loading-spinner');
    });
});
