/**
 * ROK-1868 — `CharCounter`, extracted from `Textarea` (ROK-1646): an `n/max`
 * readout plus a separate `sr-only` polite region that only speaks near the
 * limit; `invalid` (or going over `max`) switches it to the danger token.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CharCounter } from './char-counter';

describe('CharCounter', () => {
    it('shows n/max on the dim token and stays silent far from the limit', () => {
        render(<CharCounter id="c" length={5} max={100} />);
        const count = screen.getByTestId('char-count');
        expect(count).toHaveTextContent('5/100');
        expect(count).toHaveAttribute('id', 'c');
        expect(count).toHaveClass('text-dim');
        expect(screen.getByTestId('char-count-live')).toHaveTextContent('');
    });

    it('announces characters left near the limit', () => {
        render(<CharCounter id="c" length={95} max={100} />);
        expect(screen.getByTestId('char-count-live')).toHaveTextContent('5 characters left');
    });

    it('over max turns danger and announces the overrun', () => {
        render(<CharCounter id="c" length={4003} max={4000} />);
        expect(screen.getByTestId('char-count')).toHaveClass('text-danger');
        expect(screen.getByTestId('char-count-live')).toHaveTextContent('3 characters over the limit');
    });

    it('invalid forces the danger token; testId renames both nodes', () => {
        render(<CharCounter id="c" length={1} max={10} invalid testId="body-count" />);
        expect(screen.getByTestId('body-count')).toHaveClass('text-danger');
        expect(screen.getByTestId('body-count-live')).toBeInTheDocument();
    });
});
