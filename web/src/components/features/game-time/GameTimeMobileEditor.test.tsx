import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameTimeMobileEditor } from './GameTimeMobileEditor';
import type { GameTimeSlot } from '@raid-ledger/contract';

describe('GameTimeMobileEditor', () => {
    const mockOnChange = vi.fn();

    const defaultProps = {
        slots: [],
        onChange: mockOnChange,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Rendering', () => {
        it('renders with testid for identification', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);
            expect(screen.getByTestId('game-time-mobile-editor')).toBeInTheDocument();
        });

        it('renders all 7 day sections', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);
            expect(screen.getByText('Sunday')).toBeInTheDocument();
            expect(screen.getByText('Monday')).toBeInTheDocument();
            expect(screen.getByText('Tuesday')).toBeInTheDocument();
            expect(screen.getByText('Wednesday')).toBeInTheDocument();
            expect(screen.getByText('Thursday')).toBeInTheDocument();
            expect(screen.getByText('Friday')).toBeInTheDocument();
            expect(screen.getByText('Saturday')).toBeInTheDocument();
        });

        it('renders timezone label when provided', () => {
            render(<GameTimeMobileEditor {...defaultProps} tzLabel="PST" />);
            expect(screen.getByText('PST')).toBeInTheDocument();
        });

        it('does not render timezone label when not provided', () => {
            const { container } = render(<GameTimeMobileEditor {...defaultProps} />);
            expect(container.textContent).not.toContain('PST');
        });

        it('all days are collapsed by default', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);
            expect(screen.queryByText('Morning')).not.toBeInTheDocument();
        });
    });

    describe('Day Expansion', () => {
        it('expands day when header is clicked', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);
            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);
            expect(screen.getByText('Morning')).toBeInTheDocument();
        });

        it('collapses day when header is clicked again', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);
            const sundayHeader = screen.getByText('Sunday').closest('button')!;

            fireEvent.click(sundayHeader);
            expect(screen.getByText('Morning')).toBeInTheDocument();

            fireEvent.click(sundayHeader);
            expect(screen.queryByText('Morning')).not.toBeInTheDocument();
        });

        it('only one day can be expanded at a time', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            const mondayHeader = screen.getByText('Monday').closest('button')!;

            fireEvent.click(sundayHeader);
            expect(screen.getByText('Morning')).toBeInTheDocument();

            fireEvent.click(mondayHeader);
            // Only Monday's presets should be visible now
            const presets = screen.getAllByText('Morning');
            expect(presets.length).toBe(1);
        });
    });

    describe('Hour Toggle', () => {
        it('adds hour when toggled on', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const hour6 = screen.getByText('6a');
            fireEvent.click(hour6);

            expect(mockOnChange).toHaveBeenCalledWith([
                { dayOfWeek: 0, hour: 6, status: 'available' },
            ]);
        });

        it('removes hour when toggled off', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
            ];
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const hour6 = screen.getByText('6a');
            fireEvent.click(hour6);

            expect(mockOnChange).toHaveBeenCalledWith([]);
        });

        it('does not toggle hours in read-only mode', () => {
            render(<GameTimeMobileEditor {...defaultProps} readOnly={true} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const hour6 = screen.getByText('6a');
            fireEvent.click(hour6);

            expect(mockOnChange).not.toHaveBeenCalled();
        });

        it('preserves other hours when toggling', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 1, hour: 7, status: 'available' },
            ];
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const hour8 = screen.getByText('8a');
            fireEvent.click(hour8);

            expect(mockOnChange).toHaveBeenCalledWith([
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 1, hour: 7, status: 'available' },
                { dayOfWeek: 0, hour: 8, status: 'available' },
            ]);
        });
    });

    describe('Preset Application', () => {
        it('applies morning preset (6a-12p)', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const morningBtn = screen.getByText('Morning');
            fireEvent.click(morningBtn);

            expect(mockOnChange).toHaveBeenCalledWith(
                expect.arrayContaining([
                    { dayOfWeek: 0, hour: 6, status: 'available' },
                    { dayOfWeek: 0, hour: 7, status: 'available' },
                    { dayOfWeek: 0, hour: 8, status: 'available' },
                    { dayOfWeek: 0, hour: 9, status: 'available' },
                    { dayOfWeek: 0, hour: 10, status: 'available' },
                    { dayOfWeek: 0, hour: 11, status: 'available' },
                ])
            );
        });

        it('applies afternoon preset (12p-6p)', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const afternoonBtn = screen.getByText('Afternoon');
            fireEvent.click(afternoonBtn);

            const call = mockOnChange.mock.calls[0][0] as GameTimeSlot[];
            const hours = call.map(s => s.hour).sort((a, b) => a - b);
            expect(hours).toEqual([12, 13, 14, 15, 16, 17]);
        });

        it('applies evening preset (6p-12a)', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const eveningBtn = screen.getByText('Evening');
            fireEvent.click(eveningBtn);

            const call = mockOnChange.mock.calls[0][0] as GameTimeSlot[];
            const hours = call.map(s => s.hour).sort((a, b) => a - b);
            expect(hours).toEqual([18, 19, 20, 21, 22, 23]);
        });

        it('applies night preset (12a-6a)', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const nightBtn = screen.getByText('Night');
            fireEvent.click(nightBtn);

            const call = mockOnChange.mock.calls[0][0] as GameTimeSlot[];
            const hours = call.map(s => s.hour).sort((a, b) => a - b);
            expect(hours).toEqual([0, 1, 2, 3, 4, 5]);
        });

        it('removes preset hours when all are active (toggle off)', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'available' },
                { dayOfWeek: 0, hour: 8, status: 'available' },
                { dayOfWeek: 0, hour: 9, status: 'available' },
                { dayOfWeek: 0, hour: 10, status: 'available' },
                { dayOfWeek: 0, hour: 11, status: 'available' },
            ];
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const morningBtn = screen.getByText('Morning');
            fireEvent.click(morningBtn);

            expect(mockOnChange).toHaveBeenCalledWith([]);
        });

        it('adds only missing hours in preset', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
                { dayOfWeek: 0, hour: 7, status: 'available' },
            ];
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const morningBtn = screen.getByText('Morning');
            fireEvent.click(morningBtn);

            const call = mockOnChange.mock.calls[0][0] as GameTimeSlot[];
            const hours = call.map(s => s.hour).sort((a, b) => a - b);
            expect(hours).toEqual([6, 7, 8, 9, 10, 11]);
        });

        it('does not apply presets in read-only mode', () => {
            render(<GameTimeMobileEditor {...defaultProps} readOnly={true} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            // Presets should not be visible in read-only mode
            expect(screen.queryByText('Morning')).not.toBeInTheDocument();
        });
    });

    describe('Read-Only Mode', () => {
        it('displays slots in read-only mode', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6, status: 'available' },
            ];
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} readOnly={true} />);

            expect(screen.getByText('1h selected')).toBeInTheDocument();
        });

        it('hides preset buttons in read-only mode', () => {
            render(<GameTimeMobileEditor {...defaultProps} readOnly={true} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            expect(screen.queryByText('Morning')).not.toBeInTheDocument();
            expect(screen.queryByText('Afternoon')).not.toBeInTheDocument();
        });

        it('disables hour buttons in read-only mode', () => {
            render(<GameTimeMobileEditor {...defaultProps} readOnly={true} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const hour6 = screen.getByText('6a').closest('button');
            expect(hour6).toBeDisabled();
        });
    });

    describe('Edge Cases', () => {
        it('handles undefined readOnly prop (defaults to editable)', () => {
            const props = { ...defaultProps };
            delete (props as { readOnly?: boolean }).readOnly;

            render(<GameTimeMobileEditor {...props} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            expect(screen.getByText('Morning')).toBeInTheDocument();
        });

        it('handles empty slots array', () => {
            render(<GameTimeMobileEditor {...defaultProps} slots={[]} />);

            expect(screen.getByText('Sunday')).toBeInTheDocument();
            screen.getAllByText('None').forEach(element => {
                expect(element).toBeInTheDocument();
            });
        });

        it('handles slots with no status (treats as available)', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 6 } as GameTimeSlot,
            ];
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} />);

            expect(screen.getByText('1h selected')).toBeInTheDocument();
        });

        it('handles slots for all 7 days', () => {
            const slots: GameTimeSlot[] = Array.from({ length: 7 }, (_, i) => ({
                dayOfWeek: i,
                hour: 12,
                status: 'available' as const,
            }));
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} />);

            const selectedTexts = screen.getAllByText('1h selected');
            expect(selectedTexts.length).toBe(7);
        });

        it('handles removing a slot that does not exist', () => {
            render(<GameTimeMobileEditor {...defaultProps} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            // Try to add hour 6
            const hour6 = screen.getByText('6a');
            fireEvent.click(hour6);

            expect(mockOnChange).toHaveBeenCalledWith([
                { dayOfWeek: 0, hour: 6, status: 'available' },
            ]);
        });

        it('preserves slots from other days when toggling', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 1, hour: 10, status: 'available' },
                { dayOfWeek: 2, hour: 15, status: 'available' },
            ];
            render(<GameTimeMobileEditor {...defaultProps} slots={slots} />);

            const sundayHeader = screen.getByText('Sunday').closest('button')!;
            fireEvent.click(sundayHeader);

            const hour6 = screen.getByText('6a');
            fireEvent.click(hour6);

            expect(mockOnChange).toHaveBeenCalledWith([
                { dayOfWeek: 1, hour: 10, status: 'available' },
                { dayOfWeek: 2, hour: 15, status: 'available' },
                { dayOfWeek: 0, hour: 6, status: 'available' },
            ]);
        });
    });

    describe('Responsive Behavior', () => {
        it('uses compact layout suitable for mobile', () => {
            const { container } = render(<GameTimeMobileEditor {...defaultProps} />);
            const editor = container.querySelector('[data-testid="game-time-mobile-editor"]');
            expect(editor).toHaveClass('space-y-2');
        });

        it('timezone label uses small font size', () => {
            render(<GameTimeMobileEditor {...defaultProps} tzLabel="PST" />);
            const label = screen.getByText('PST').closest('span');
            expect(label).toHaveClass('text-[10px]');
        });
    });
});
