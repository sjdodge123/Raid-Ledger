import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapLegend, MapSnapshotFooter } from './map-legend';

describe('MapLegend (prototype .maplegend)', () => {
    it('labels the three fog tones with visible text and hidden swatches', () => {
        const { container } = render(<MapLegend />);
        const legend = screen.getByRole('list', { name: 'Map legend' });
        expect(legend).toHaveTextContent(
            /Explored.*Cartography table.*Unexplored/,
        );
        const swatches = container.querySelectorAll('[data-fog-swatch]');
        expect(swatches).toHaveLength(3);
        swatches.forEach((s) =>
            expect(s).toHaveAttribute('aria-hidden', 'true'),
        );
    });
});

describe('MapSnapshotFooter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('shows "Latest snapshot · captured <relative>" in a <time>', () => {
        const at = '2026-10-19T10:00:00.000Z';
        render(<MapSnapshotFooter capturedAt={at} />);
        expect(
            screen.getByText(/Latest snapshot · captured/),
        ).toHaveTextContent('Latest snapshot · captured about 2 hours ago');
        const time = screen.getByText('about 2 hours ago');
        expect(time.tagName).toBe('TIME');
        expect(time).toHaveAttribute('dateTime', at);
        expect(time.getAttribute('title')).toBeTruthy();
    });
});
