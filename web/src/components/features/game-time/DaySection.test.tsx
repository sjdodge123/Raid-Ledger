import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DaySection } from './DaySection';
import type { GameTimeSlot } from '@raid-ledger/contract';

describe('DaySection', () => {
    const mockOnToggle = vi.fn();
    const mockOnHourToggle = vi.fn();
    const mockOnPreset = vi.fn();

    const defaultProps = {
        dayIndex: 0,
        slots: [],
        expanded: false,
        onToggle: mockOnToggle,
        onHourToggle: mockOnHourToggle,
        onPreset: mockOnPreset,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    describe('Day Header', () => {
        it('renders day name for Sunday (index 0)', () => {
            render(<DaySection {...defaultProps} dayIndex={0} />);
            expect(screen.getByText('Sunday')).toBeInTheDocument();
        });

        it('renders day name for Wednesday (index 3)', () => {
            render(<DaySection {...defaultProps} dayIndex={3} />);
            expect(screen.getByText('Wednesday')).toBeInTheDocument();
        });

        it('shows "None" when no hours are selected', () => {
            render(<DaySection {...defaultProps} />);
            expect(screen.getByText('None')).toBeInTheDocument();
        });

        it('shows hour count when hours are selected', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'available' },
                { dayOfWeek: 0, hour: 8, status: 'available' },
            ];
            render(<DaySection {...defaultProps} slots={slots} />);
            expect(screen.getByText('3h selected')).toBeInTheDocument();
        });

        it('calls onToggle when header is clicked', () => {
            render(<DaySection {...defaultProps} />);
            const header = screen.getByRole('button', { name: /Sunday/ });
            fireEvent.click(header);
            expect(mockOnToggle).toHaveBeenCalledOnce();
        });

        it('chevron rotates when expanded', () => {
            const { rerender } = render(<DaySection {...defaultProps} expanded={false} />);
            const svg = screen.getByRole('button', { name: /Sunday/ }).querySelector('svg');
            expect(svg).not.toHaveClass('rotate-90');

            rerender(<DaySection {...defaultProps} expanded={true} />);
            expect(svg).toHaveClass('rotate-90');
        });
    });

    describe('Expanded Content', () => {
        it('hides content when collapsed', () => {
            render(<DaySection {...defaultProps} expanded={false} />);
            expect(screen.queryByText('Morning')).not.toBeInTheDocument();
        });

        it('shows content when expanded', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            expect(screen.getByText('Morning')).toBeInTheDocument();
        });
    });

    describe('Preset Buttons', () => {
        it('renders all four preset buttons', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            expect(screen.getByText('Morning')).toBeInTheDocument();
            expect(screen.getByText('Afternoon')).toBeInTheDocument();
            expect(screen.getByText('Evening')).toBeInTheDocument();
            expect(screen.getByText('Night')).toBeInTheDocument();
        });

        it('shows time ranges for each preset', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            expect(screen.getByText('6a-12p')).toBeInTheDocument();
            expect(screen.getByText('12p-6p')).toBeInTheDocument();
            expect(screen.getByText('6p-12a')).toBeInTheDocument();
            expect(screen.getByText('12a-6a')).toBeInTheDocument();
        });

        it('calls onPreset when morning is clicked', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            fireEvent.click(screen.getByText('Morning'));
            expect(mockOnPreset).toHaveBeenCalledWith(0, 'morning');
        });

        it('calls onPreset when afternoon is clicked', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            fireEvent.click(screen.getByText('Afternoon'));
            expect(mockOnPreset).toHaveBeenCalledWith(0, 'afternoon');
        });

        it('calls onPreset when evening is clicked', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            fireEvent.click(screen.getByText('Evening'));
            expect(mockOnPreset).toHaveBeenCalledWith(0, 'evening');
        });

        it('calls onPreset when night is clicked', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            fireEvent.click(screen.getByText('Night'));
            expect(mockOnPreset).toHaveBeenCalledWith(0, 'night');
        });

        it('highlights preset when all hours are active', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'available' },
                { dayOfWeek: 0, hour: 8, status: 'available' },
                { dayOfWeek: 0, hour: 9, status: 'available' },
                { dayOfWeek: 0, hour: 10, status: 'available' },
                { dayOfWeek: 0, hour: 11, status: 'available' },
            ];
            render(<DaySection {...defaultProps} slots={slots} expanded={true} />);

            const morningBtn = screen.getByText('Morning').closest('button');
            expect(morningBtn).toHaveClass('bg-emerald-500/20');
        });

        it('does not highlight preset when hours are partially active', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'available' },
            ];
            render(<DaySection {...defaultProps} slots={slots} expanded={true} />);

            const morningBtn = screen.getByText('Morning').closest('button');
            expect(morningBtn).not.toHaveClass('bg-emerald-500/20');
        });

        it('hides presets in read-only mode', () => {
            render(<DaySection {...defaultProps} expanded={true} readOnly={true} />);
            expect(screen.queryByText('Morning')).not.toBeInTheDocument();
        });
    });

    describe('Hour Buttons', () => {
        it('renders all 24 hour buttons when expanded', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            const hourButtons = screen.getAllByRole('button').filter(
                (btn) => btn.textContent?.match(/^\d+(a|p)$/)
            );
            expect(hourButtons.length).toBe(24);
        });

        it('formats midnight as 12a', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            expect(screen.getByText('12a')).toBeInTheDocument();
        });

        it('formats noon as 12p', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            expect(screen.getByText('12p')).toBeInTheDocument();
        });

        it('formats AM hours correctly', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            expect(screen.getByText('1a')).toBeInTheDocument();
            expect(screen.getByText('6a')).toBeInTheDocument();
            expect(screen.getByText('11a')).toBeInTheDocument();
        });

        it('formats PM hours correctly', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            expect(screen.getByText('1p')).toBeInTheDocument();
            expect(screen.getByText('6p')).toBeInTheDocument();
            expect(screen.getByText('11p')).toBeInTheDocument();
        });

        it('calls onHourToggle when hour button is clicked', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            fireEvent.click(screen.getByText('6a'));
            expect(mockOnHourToggle).toHaveBeenCalledWith(0, 6);
        });

        it('highlights active hours with emerald background', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
            ];
            render(<DaySection {...defaultProps} slots={slots} expanded={true} />);

            const hourBtn = screen.getByText('6a').closest('button');
            expect(hourBtn).toHaveClass('bg-emerald-500/15');
        });

        it('does not highlight inactive hours', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            const hourBtn = screen.getByText('6a').closest('button');
            expect(hourBtn).not.toHaveClass('bg-emerald-500/15');
        });

        it('has 48px height (meets 44px minimum tap target)', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            const hourBtn = screen.getByText('6a').closest('button');
            expect(hourBtn).toHaveClass('h-12'); // h-12 = 3rem = 48px
        });

        it('disables hour buttons in read-only mode', () => {
            render(<DaySection {...defaultProps} expanded={true} readOnly={true} />);
            const hourBtn = screen.getByText('6a').closest('button');
            expect(hourBtn).toBeDisabled();
        });

        it('does not call onHourToggle when disabled', () => {
            render(<DaySection {...defaultProps} expanded={true} readOnly={true} />);
            fireEvent.click(screen.getByText('6a'));
            expect(mockOnHourToggle).not.toHaveBeenCalled();
        });

        it('applies active:scale-95 feedback in edit mode', () => {
            render(<DaySection {...defaultProps} expanded={true} />);
            const hourBtn = screen.getByText('6a').closest('button');
            expect(hourBtn).toHaveClass('active:scale-95');
        });

        it('does not apply active:scale-95 in read-only mode', () => {
            render(<DaySection {...defaultProps} expanded={true} readOnly={true} />);
            const hourBtn = screen.getByText('6a').closest('button');
            expect(hourBtn).not.toHaveClass('active:scale-95');
        });
    });

    describe('4-Column Grid Layout', () => {
        it('uses grid-cols-4 for hour buttons', () => {
            const { container } = render(<DaySection {...defaultProps} expanded={true} />);
            const hourGrid = container.querySelector('.grid-cols-4');
            expect(hourGrid).toBeInTheDocument();
        });

        it('uses grid-cols-4 for preset buttons', () => {
            const { container } = render(<DaySection {...defaultProps} expanded={true} />);
            const presetGrid = container.querySelectorAll('.grid-cols-4');
            expect(presetGrid.length).toBeGreaterThan(0);
        });
    });

    describe('Edge Cases', () => {
        it('handles slots with no status (treats as available)', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6 } as GameTimeSlot,
            ];
            render(<DaySection {...defaultProps} slots={slots} expanded={true} />);
            expect(screen.getByText('1h selected')).toBeInTheDocument();
        });

        it('ignores slots from other days', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 1, hour: 6, status: 'available' },
                { dayOfWeek: 2, hour: 7, status: 'available' },
            ];
            render(<DaySection {...defaultProps} dayIndex={0} slots={slots} />);
            expect(screen.getByText('None')).toBeInTheDocument();
        });

        it('handles empty slots array', () => {
            render(<DaySection {...defaultProps} slots={[]} />);
            expect(screen.getByText('None')).toBeInTheDocument();
        });

        it('handles all 24 hours selected', () => {
            const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
                dayOfWeek: 0,
                hour: i,
                status: 'available' as const,
            }));
            render(<DaySection {...defaultProps} slots={slots} />);
            expect(screen.getByText('24h selected')).toBeInTheDocument();
        });

        it('only counts available slots (not blocked/committed)', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'blocked' },
                { dayOfWeek: 0, hour: 8, status: 'committed' },
            ];
            render(<DaySection {...defaultProps} slots={slots} />);
            expect(screen.getByText('1h selected')).toBeInTheDocument();
        });
    });
});
