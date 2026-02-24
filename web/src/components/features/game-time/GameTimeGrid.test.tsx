import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimeSlot, GameTimePreviewBlock, HeatmapCell } from './GameTimeGrid';

describe('GameTimeGrid', () => {
    it('renders 7 day headers (Sunday first)', () => {
        render(<GameTimeGrid slots={[]} />);
        expect(screen.getByTestId('day-header-0')).toHaveTextContent('Sun');
        expect(screen.getByTestId('day-header-1')).toHaveTextContent('Mon');
        expect(screen.getByTestId('day-header-6')).toHaveTextContent('Sat');
    });

    it('renders 168 cells (7 days x 24 hours)', () => {
        const { container } = render(<GameTimeGrid slots={[]} />);
        const cells = container.querySelectorAll('[data-testid^="cell-"]');
        expect(cells).toHaveLength(168);
    });

    it('renders available slots with correct status', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 18, status: 'available' },
        ];
        render(<GameTimeGrid slots={slots} />);

        const cell = screen.getByTestId('cell-0-18');
        expect(cell.dataset.status).toBe('available');
    });

    it('renders committed slots with correct status', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 2, hour: 20, status: 'committed' },
        ];
        render(<GameTimeGrid slots={slots} />);

        const cell = screen.getByTestId('cell-2-20');
        expect(cell.dataset.status).toBe('committed');
    });

    it('renders blocked slots with correct status', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 3, hour: 14, status: 'blocked' },
        ];
        render(<GameTimeGrid slots={slots} />);

        const cell = screen.getByTestId('cell-3-14');
        expect(cell.dataset.status).toBe('blocked');
    });

    it('renders inactive cells for empty slots', () => {
        render(<GameTimeGrid slots={[]} />);

        const cell = screen.getByTestId('cell-0-0');
        expect(cell.dataset.status).toBe('inactive');
    });

    it('click toggles cell from inactive to available', () => {
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} />);

        fireEvent.pointerDown(screen.getByTestId('cell-1-10'));
        fireEvent.pointerUp(screen.getByTestId('cell-1-10'));

        expect(onChange).toHaveBeenCalledWith([
            { dayOfWeek: 1, hour: 10, status: 'available' },
        ]);
    });

    it('click toggles cell from available to inactive (erase)', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 1, hour: 10, status: 'available' },
        ];
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);

        fireEvent.pointerDown(screen.getByTestId('cell-1-10'));
        fireEvent.pointerUp(screen.getByTestId('cell-1-10'));

        expect(onChange).toHaveBeenCalledWith([]);
    });

    it('drag paints multiple cells', () => {
        const onChange = vi.fn();
        const { getByTestId } = render(
            <GameTimeGrid slots={[]} onChange={onChange} />,
        );

        fireEvent.pointerDown(getByTestId('cell-0-8'));
        expect(onChange).toHaveBeenCalledTimes(1);

        fireEvent.pointerEnter(getByTestId('cell-0-9'));
        expect(onChange).toHaveBeenCalledTimes(2);

        fireEvent.pointerUp(getByTestId('cell-0-9'));
    });

    it('readOnly mode prevents interaction', () => {
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} readOnly />);

        fireEvent.pointerDown(screen.getByTestId('cell-0-0'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('committed cells are NOT paintable', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 18, status: 'committed' },
        ];
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);

        fireEvent.pointerDown(screen.getByTestId('cell-0-18'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('blocked cells are NOT paintable', () => {
        const slots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 18, status: 'blocked' },
        ];
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);

        fireEvent.pointerDown(screen.getByTestId('cell-0-18'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when onChange is not provided', () => {
        render(<GameTimeGrid slots={[]} />);

        // Should not throw
        fireEvent.pointerDown(screen.getByTestId('cell-0-0'));
    });

    it('respects hourRange prop (only renders visible hours)', () => {
        const { container } = render(<GameTimeGrid slots={[]} hourRange={[6, 24]} />);
        const cells = container.querySelectorAll('[data-testid^="cell-"]');
        // 7 days x 18 hours (6 to 24)
        expect(cells).toHaveLength(7 * 18);
    });

    describe('event block overlays', () => {
        const mockEvents = [
            {
                eventId: 1,
                title: 'Raid Night',
                gameSlug: 'world-of-warcraft',
                gameName: 'World of Warcraft',
                coverUrl: null,
                signupId: 10,
                confirmationStatus: 'confirmed' as const,
                dayOfWeek: 0,
                startHour: 18,
                endHour: 21,
            },
        ];

        it('renders event block overlays when events prop is provided', () => {
            render(<GameTimeGrid slots={[]} events={mockEvents} />);
            expect(screen.getByTestId('event-block-1-0')).toBeInTheDocument();
            expect(screen.getByText('Raid Night')).toBeInTheDocument();
        });

        it('clicking event block calls onEventClick', () => {
            const onEventClick = vi.fn();
            render(<GameTimeGrid slots={[]} events={mockEvents} onEventClick={onEventClick} />);

            fireEvent.click(screen.getByTestId('event-block-1-0'));
            expect(onEventClick).toHaveBeenCalledTimes(1);
            expect(onEventClick.mock.calls[0][0]).toMatchObject({ eventId: 1 });
        });

        it('event blocks do not interfere with drag-to-paint', () => {
            const onChange = vi.fn();
            render(<GameTimeGrid slots={[]} events={mockEvents} onChange={onChange} />);

            fireEvent.pointerDown(screen.getByTestId('cell-3-10'));
            expect(onChange).toHaveBeenCalledTimes(1);
        });
    });

    describe('preview block overlays', () => {
        it('renders preview blocks', () => {
            const previewBlocks = [
                { dayOfWeek: 0, startHour: 19, endHour: 22, label: 'This Event' },
            ];
            render(<GameTimeGrid slots={[]} previewBlocks={previewBlocks} />);
            const block = screen.getByTestId('preview-block-0-19');
            expect(block).toBeInTheDocument();
        });

        it('renders preview block content when no event block underneath', () => {
            const previewBlocks = [
                {
                    dayOfWeek: 1,
                    startHour: 19,
                    endHour: 22,
                    title: 'Raid Night',
                    gameName: 'WoW',
                    gameSlug: 'world-of-warcraft',
                },
            ];
            render(<GameTimeGrid slots={[]} previewBlocks={previewBlocks} />);
            const block = screen.getByTestId('preview-block-1-19');
            expect(block).toBeInTheDocument();
            // Shows content when no event block exists at same position
            expect(block.textContent).toContain('Raid Night');
        });
    });

    describe('fullDayNames prop (ROK-301)', () => {
        it('renders abbreviated day names by default', () => {
            render(<GameTimeGrid slots={[]} />);

            expect(screen.getByTestId('day-header-0')).toHaveTextContent('Sun');
            expect(screen.getByTestId('day-header-1')).toHaveTextContent('Mon');
            expect(screen.getByTestId('day-header-2')).toHaveTextContent('Tue');
            expect(screen.getByTestId('day-header-3')).toHaveTextContent('Wed');
            expect(screen.getByTestId('day-header-4')).toHaveTextContent('Thu');
            expect(screen.getByTestId('day-header-5')).toHaveTextContent('Fri');
            expect(screen.getByTestId('day-header-6')).toHaveTextContent('Sat');
        });

        it('renders full day names when fullDayNames=true', () => {
            render(<GameTimeGrid slots={[]} fullDayNames={true} />);

            expect(screen.getByTestId('day-header-0')).toHaveTextContent('Sunday');
            expect(screen.getByTestId('day-header-1')).toHaveTextContent('Monday');
            expect(screen.getByTestId('day-header-2')).toHaveTextContent('Tuesday');
            expect(screen.getByTestId('day-header-3')).toHaveTextContent('Wednesday');
            expect(screen.getByTestId('day-header-4')).toHaveTextContent('Thursday');
            expect(screen.getByTestId('day-header-5')).toHaveTextContent('Friday');
            expect(screen.getByTestId('day-header-6')).toHaveTextContent('Saturday');
        });

        it('renders abbreviated day names when fullDayNames=false', () => {
            render(<GameTimeGrid slots={[]} fullDayNames={false} />);

            expect(screen.getByTestId('day-header-0')).toHaveTextContent('Sun');
            expect(screen.getByTestId('day-header-1')).toHaveTextContent('Mon');
            expect(screen.getByTestId('day-header-6')).toHaveTextContent('Sat');
        });

        it('full day names work with weekStart dates', () => {
            render(<GameTimeGrid slots={[]} fullDayNames={true} weekStart="2026-02-08" />);

            const header0 = screen.getByTestId('day-header-0');
            expect(header0).toHaveTextContent('Sunday');
            // Should also show the date (2/8)
            expect(header0).toHaveTextContent('2/8');
        });
    });

    // === ROK-370: Fix reschedule modal grid click offset ===

    describe('compact prop (ROK-370)', () => {
        it('compact mode does not affect slot status rendering', () => {
            const slots: GameTimeSlot[] = [
                { dayOfWeek: 0, hour: 10, status: 'available' },
                { dayOfWeek: 1, hour: 10, status: 'committed' },
                { dayOfWeek: 2, hour: 10, status: 'blocked' },
            ];
            render(<GameTimeGrid slots={slots} compact />);
            expect(screen.getByTestId('cell-0-10').dataset.status).toBe('available');
            expect(screen.getByTestId('cell-1-10').dataset.status).toBe('committed');
            expect(screen.getByTestId('cell-2-10').dataset.status).toBe('blocked');
        });

        it('compact mode does not affect drag-to-paint interaction', () => {
            const onChange = vi.fn();
            render(<GameTimeGrid slots={[]} compact onChange={onChange} />);
            fireEvent.pointerDown(screen.getByTestId('cell-2-8'));
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange.mock.calls[0][0]).toEqual([{ dayOfWeek: 2, hour: 8, status: 'available' }]);
        });

        it('compact mode does not affect onCellClick', () => {
            const onCellClick = vi.fn();
            render(<GameTimeGrid slots={[]} compact onCellClick={onCellClick} />);
            fireEvent.click(screen.getByTestId('cell-4-15'));
            expect(onCellClick).toHaveBeenCalledWith(4, 15);
        });
    });

    describe('wrapperRef measurement approach (ROK-370)', () => {
        it('grid element has data-testid for querySelector-based measurement', () => {
            render(<GameTimeGrid slots={[]} />);
            expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
        });

        it('all day headers have data-testid attributes needed for measurement', () => {
            render(<GameTimeGrid slots={[]} />);
            for (let i = 0; i < 7; i++) {
                expect(screen.getByTestId(`day-header-${i}`)).toBeInTheDocument();
            }
        });

        it('all cells have data-testid attributes needed for measurement', () => {
            render(<GameTimeGrid slots={[]} hourRange={[10, 12]} />);
            for (let day = 0; day < 7; day++) {
                for (let hour = 10; hour < 12; hour++) {
                    expect(screen.getByTestId(`cell-${day}-${hour}`)).toBeInTheDocument();
                }
            }
        });
    });

    describe('heatmap overlay with compact grid (ROK-370)', () => {
        const heatmapCells: HeatmapCell[] = [
            { dayOfWeek: 0, hour: 10, availableCount: 3, totalCount: 4 },
            { dayOfWeek: 1, hour: 10, availableCount: 4, totalCount: 4 },
            { dayOfWeek: 2, hour: 10, availableCount: 1, totalCount: 4 },
        ];

        it('heatmap cells get title attribute with availability info', () => {
            render(<GameTimeGrid slots={[]} compact heatmapOverlay={heatmapCells} />);
            expect(screen.getByTestId('cell-0-10').title).toBe('3 of 4 players available');
            expect(screen.getByTestId('cell-1-10').title).toBe('4 of 4 players available');
            expect(screen.getByTestId('cell-2-10').title).toBe('1 of 4 players available');
        });

        it('non-heatmap cells do not get title attribute', () => {
            render(<GameTimeGrid slots={[]} compact heatmapOverlay={heatmapCells} />);
            const cell = screen.getByTestId('cell-3-10');
            expect(cell.title).toBeFalsy();
        });

        it('onCellClick works with heatmap overlay in compact mode', () => {
            const onCellClick = vi.fn();
            render(<GameTimeGrid slots={[]} compact heatmapOverlay={heatmapCells} onCellClick={onCellClick} />);
            fireEvent.click(screen.getByTestId('cell-0-10'));
            expect(onCellClick).toHaveBeenCalledWith(0, 10);
        });
    });

    describe('hourRange edge cases (ROK-370)', () => {
        it('hourRange [6, 24] renders 18 hours per day', () => {
            const { container } = render(<GameTimeGrid slots={[]} hourRange={[6, 24]} />);
            const cells = container.querySelectorAll('[data-testid^="cell-"]');
            expect(cells).toHaveLength(7 * 18);
        });

        it('hourRange [0, 6] renders only early morning hours', () => {
            const { container } = render(<GameTimeGrid slots={[]} hourRange={[0, 6]} />);
            const cells = container.querySelectorAll('[data-testid^="cell-"]');
            expect(cells).toHaveLength(7 * 6);
            expect(screen.getByTestId('cell-0-0')).toBeInTheDocument();
            expect(screen.getByTestId('cell-0-5')).toBeInTheDocument();
            expect(screen.queryByTestId('cell-0-6')).not.toBeInTheDocument();
        });

        it('hourRange [12, 18] renders afternoon hours only', () => {
            render(<GameTimeGrid slots={[]} hourRange={[12, 18]} />);
            expect(screen.getByTestId('cell-0-12')).toBeInTheDocument();
            expect(screen.getByTestId('cell-0-17')).toBeInTheDocument();
            expect(screen.queryByTestId('cell-0-11')).not.toBeInTheDocument();
            expect(screen.queryByTestId('cell-0-18')).not.toBeInTheDocument();
        });
    });
});
