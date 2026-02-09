import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimeSlot } from './GameTimeGrid';

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

    it('highlights today column when todayIndex is provided', () => {
        render(<GameTimeGrid slots={[]} todayIndex={3} />);
        const todayHeader = screen.getByTestId('day-header-3');
        expect(todayHeader.className).toContain('emerald');
    });

    describe('event block overlays', () => {
        const mockEvents = [
            {
                eventId: 1,
                title: 'Raid Night',
                gameSlug: 'wow',
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
        it('renders preview blocks with dashed border styling', () => {
            const previewBlocks = [
                { dayOfWeek: 0, startHour: 19, endHour: 22, label: 'This Event' },
            ];
            render(<GameTimeGrid slots={[]} previewBlocks={previewBlocks} />);
            const block = screen.getByTestId('preview-block-0-19');
            expect(block).toBeInTheDocument();
            expect(block.style.border).toContain('dashed');
        });

        it('preview blocks are pointer-events-none (non-interactive)', () => {
            const previewBlocks = [
                { dayOfWeek: 2, startHour: 10, endHour: 12 },
            ];
            render(<GameTimeGrid slots={[]} previewBlocks={previewBlocks} />);
            const block = screen.getByTestId('preview-block-2-10');
            expect(block.classList.contains('pointer-events-none')).toBe(true);
        });

        it('renders preview block content when no event block underneath', () => {
            const previewBlocks = [
                {
                    dayOfWeek: 1,
                    startHour: 19,
                    endHour: 22,
                    title: 'Raid Night',
                    gameName: 'WoW',
                    gameSlug: 'wow',
                },
            ];
            render(<GameTimeGrid slots={[]} previewBlocks={previewBlocks} />);
            const block = screen.getByTestId('preview-block-1-19');
            expect(block).toBeInTheDocument();
            // Shows content when no event block exists at same position
            expect(block.textContent).toContain('Raid Night');
        });
    });
});
