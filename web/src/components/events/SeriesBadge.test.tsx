import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SeriesBadge } from './SeriesBadge';

describe('SeriesBadge — title prop (ROK-1728 §5.4)', () => {
    it('keeps the default "Recurring series" title at the existing call sites', () => {
        render(<SeriesBadge />);
        expect(screen.getByTestId('series-badge')).toHaveAttribute('title', 'Recurring series');
    });

    it('uses the title it is given', () => {
        render(<SeriesBadge title="Signed up for the series" showLabel />);
        const badge = screen.getByTestId('series-badge');
        expect(badge).toHaveAttribute('title', 'Signed up for the series');
        expect(badge).toHaveTextContent('Series');
    });

    it('is icon-only by default', () => {
        render(<SeriesBadge />);
        expect(screen.getByTestId('series-badge')).not.toHaveTextContent('Series');
    });
});
