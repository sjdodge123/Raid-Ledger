import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimeSlot } from '@raid-ledger/contract';

describe('GameTimeGrid — whole-day toggle (ROK-619)', () => {
    it('clicking day header selects all 24 hours when day is empty', () => {
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} />);

        fireEvent.click(screen.getByTestId('day-header-0'));

        expect(onChange).toHaveBeenCalledTimes(1);
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result).toHaveLength(24);
        const hours = result.map((s) => s.hour).sort((a, b) => a - b);
        expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
    });

    it('clicking day header deselects all when all 24 are active', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 0, hour: i, status: 'available' as const,
        }));
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);
        fireEvent.click(screen.getByTestId('day-header-0'));
        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('clicking day header fills missing hours when partially selected', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 6, status: 'available' },
            { dayOfWeek: 0, hour: 7, status: 'available' },
        ];
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);
        fireEvent.click(screen.getByTestId('day-header-0'));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result).toHaveLength(24);
    });

    it('preserves slots from other days when toggling', () => {
        const slots: GameTimeSlot[] = [{ dayOfWeek: 1, hour: 10, status: 'available' }];
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);
        fireEvent.click(screen.getByTestId('day-header-0'));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result.filter((s) => s.dayOfWeek === 1)).toHaveLength(1);
        expect(result.filter((s) => s.dayOfWeek === 0)).toHaveLength(24);
    });
});

describe('GameTimeGrid — whole-day edge cases (ROK-619)', () => {
    it('day header is not clickable in readOnly mode', () => {
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} readOnly />);
        fireEvent.click(screen.getByTestId('day-header-0'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('day header is not clickable when no onChange provided', () => {
        render(<GameTimeGrid slots={[]} />);
        const header = screen.getByTestId('day-header-0');
        expect(header).not.toHaveAttribute('role', 'button');
        fireEvent.click(header); // should not throw
    });

    it('does not toggle committed or blocked slots', () => {
        const slots: GameTimeSlot[] = [
            ...Array.from({ length: 22 }, (_, i) => ({
                dayOfWeek: 0, hour: i, status: 'available' as const,
            })),
            { dayOfWeek: 0, hour: 22, status: 'committed' as const },
            { dayOfWeek: 0, hour: 23, status: 'blocked' as const },
        ];
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);
        fireEvent.click(screen.getByTestId('day-header-0'));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result.find((s) => s.hour === 22)?.status).toBe('committed');
        expect(result.find((s) => s.hour === 23)?.status).toBe('blocked');
    });

    it('day header has button role when interactive', () => {
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} />);
        const header = screen.getByTestId('day-header-0');
        expect(header).toHaveAttribute('role', 'button');
    });

    it('day header has no button role in readOnly mode', () => {
        render(<GameTimeGrid slots={[]} readOnly />);
        const header = screen.getByTestId('day-header-0');
        expect(header).not.toHaveAttribute('role', 'button');
    });
});
