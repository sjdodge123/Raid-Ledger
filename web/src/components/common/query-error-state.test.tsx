/** ROK-2342: the shared failed-query state — friendly copy, Retry, raw message tucked away. */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryErrorState, QUERY_ERROR_COPY } from './query-error-state';

describe('QueryErrorState', () => {
    it('shows the title and friendly copy, with the raw message only inside Technical details', () => {
        render(<QueryErrorState title="Couldn't load games" error={new Error('HTTP 500: boom')} onRetry={() => undefined} />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: "Couldn't load games" })).toBeInTheDocument();
        expect(screen.getByText(QUERY_ERROR_COPY)).toBeInTheDocument();
        const raw = screen.getByText('HTTP 500: boom');
        expect(raw.closest('details')).not.toBeNull();
        expect(screen.getByText('Technical details').tagName).toBe('SUMMARY');
    });

    it('calls onRetry when Try again is pressed', () => {
        const onRetry = vi.fn();
        render(<QueryErrorState title="Couldn't load players" onRetry={onRetry} />);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('hides the button without onRetry and the details without a message', () => {
        render(<QueryErrorState title="Couldn't load plans" error={{}} />);
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
        expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
    });
});
