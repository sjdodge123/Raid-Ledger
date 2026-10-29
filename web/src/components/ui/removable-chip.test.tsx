import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RemovableChip, REMOVABLE_CHIP_CLASS } from './removable-chip';

describe('RemovableChip (ROK-2027, design-system §4.3 removable selection chip)', () => {
    it('the named Remove button calls onRemove once', async () => {
        const onRemove = vi.fn();
        render(<RemovableChip label="Callahan's deaths" removeLabel="Remove Callahan's deaths" onRemove={onRemove} />);
        await userEvent.click(screen.getByRole('button', { name: "Remove Callahan's deaths" }));
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('is a non-focusable span pill with the token class string and no aria-pressed', () => {
        render(<RemovableChip label="Deadmines" removeLabel="Remove Deadmines" onRemove={vi.fn()} testId="chip" />);
        const chip = screen.getByTestId('chip');
        expect(chip.tagName).toBe('SPAN');
        expect(chip.className).toBe(REMOVABLE_CHIP_CLASS);
        expect(REMOVABLE_CHIP_CLASS).toContain('bg-success/10 border border-success/30');
        expect(REMOVABLE_CHIP_CLASS).toContain('min-h-[44px]');
        expect(chip).not.toHaveAttribute('aria-pressed');
        expect(chip).toHaveTextContent('Deadmines');
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('renders the optional detail as muted secondary text and the icon aria-hidden', () => {
        render(<RemovableChip label="Deadmines" detail="Lv17-26" removeLabel="Remove Deadmines" onRemove={vi.fn()} testId="chip" />);
        const detail = screen.getByText('Lv17-26');
        expect(detail.className).toBe('text-xs text-muted');
        const svg = screen.getByRole('button', { name: 'Remove Deadmines' }).querySelector('svg');
        expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
});
