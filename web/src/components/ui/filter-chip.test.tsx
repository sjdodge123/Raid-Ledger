import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FunnelIcon } from '@heroicons/react/24/outline';
import { FilterChip } from './filter-chip';
import { FILTER_CHIP_BASE, FILTER_CHIP_OFF, FILTER_CHIP_ON } from './filter-chip-classes';

describe('FilterChip (ROK-1943, §4.3)', () => {
    it('is a type="button" whose aria-pressed reflects the prop', () => {
        const { rerender } = render(<FilterChip label="Portals" pressed={false} onPressedChange={vi.fn()} />);
        const chip = screen.getByRole('button', { name: 'Portals' });
        expect(chip).toHaveAttribute('type', 'button');
        expect(chip).toHaveAttribute('aria-pressed', 'false');
        rerender(<FilterChip label="Portals" pressed onPressedChange={vi.fn()} />);
        expect(chip).toHaveAttribute('aria-pressed', 'true');
    });

    it.each([[false, true], [true, false]])('pressed=%s click calls onPressedChange(%s)', async (pressed, next) => {
        const onPressedChange = vi.fn();
        render(<FilterChip label="Beds" pressed={pressed} onPressedChange={onPressedChange} />);
        await userEvent.click(screen.getByRole('button', { name: 'Beds' }));
        expect(onPressedChange).toHaveBeenCalledTimes(1);
        expect(onPressedChange).toHaveBeenCalledWith(next);
    });

    it('carries the §4.3 geometry and the ON / OFF token sets, ON label text-amber-400', () => {
        const { rerender } = render(<FilterChip label="Mines" pressed={false} onPressedChange={vi.fn()} />);
        const chip = screen.getByRole('button', { name: 'Mines' });
        expect(chip.className).toContain(FILTER_CHIP_BASE);
        expect(chip.className).toContain(FILTER_CHIP_OFF);
        rerender(<FilterChip label="Mines" pressed onPressedChange={vi.fn()} />);
        expect(chip.className).toContain(FILTER_CHIP_ON);
        expect(chip.className).toContain('text-amber-400');
        expect(chip.className).not.toContain('text-amber-300');
    });

    it('renders the leading icon aria-hidden, keeping the label as the name', () => {
        render(<FilterChip label="Bosses" pressed={false} onPressedChange={vi.fn()} icon={FunnelIcon} />);
        const chip = screen.getByRole('button', { name: 'Bosses' });
        const svg = chip.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg).toHaveAttribute('aria-hidden', 'true');
    });

    it('does not call onPressedChange while disabled; appends className and testId', async () => {
        const onPressedChange = vi.fn();
        render(<FilterChip label="Carts" pressed={false} onPressedChange={onPressedChange} disabled className="ml-2" testId="chip-carts" />);
        const chip = screen.getByTestId('chip-carts');
        expect(chip).toBeDisabled();
        expect(chip.className.endsWith(' ml-2')).toBe(true);
        await userEvent.click(chip);
        expect(onPressedChange).not.toHaveBeenCalled();
    });
});
