/**
 * ROK-1789 Part B (B-4) — the small bordered difficulty label beside a boss
 * name, shared by the Overview "Raid progress" card and the Progression tab.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DifficultyTag } from './difficulty-tag';

describe('DifficultyTag', () => {
    it('renders the label under the caller-supplied test id', () => {
        render(<DifficultyTag label="40-player" testId="raid-progress-difficulty" />);
        expect(screen.getByTestId('raid-progress-difficulty')).toHaveTextContent('40-player');
    });

    it('uses theme tokens only (bordered, dim text) so it flips with the scheme', () => {
        render(<DifficultyTag label="20-player" testId="progression-boss-difficulty" />);
        expect(screen.getByTestId('progression-boss-difficulty')).toHaveClass('border', 'border-edge', 'text-dim');
    });
});
