import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameTimeGrid } from './GameTimeGrid';

/**
 * Deliberately does NOT stub jsdom layout, so every box measures zero — the same
 * shape a real browser reports for one frame before the grid is laid out.
 *
 * A zero rowHeight used to be published anyway, and it makes the editor look
 * ready while doing nothing: DayTarget divides by rowHeight to find the tapped
 * row, gets Infinity, fails its bounds check, and drops the tap. The layer must
 * stay unmounted until the measurement is real.
 *
 * The positive case — real dimensions produce a layer with blocks — is covered
 * in GameTimeGrid.test.tsx, which stubs a plausible layout.
 */
describe('grid measurement — degenerate dimensions (ROK-1426 follow-up)', () => {
    const slots = [
        { dayOfWeek: 1, hour: 10, status: 'available' as const },
        { dayOfWeek: 1, hour: 11, status: 'available' as const },
    ];

    it('does not mount the block editor when the grid measures zero', () => {
        render(<GameTimeGrid slots={slots} onChange={vi.fn()} />);

        // The grid itself renders — only the editor layer waits.
        expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
        expect(screen.queryByTestId('block-editor-layer')).not.toBeInTheDocument();
    });

    it('renders no blocks or day targets either, so nothing looks tappable', () => {
        render(<GameTimeGrid slots={slots} onChange={vi.fn()} />);

        expect(screen.queryAllByTestId(/^slot-block-/)).toHaveLength(0);
        expect(screen.queryAllByTestId(/^slot-day-target-/)).toHaveLength(0);
    });
});
