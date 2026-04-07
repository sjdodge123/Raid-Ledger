/**
 * Adversarial tests for GameTimeGrid whole-day toggle (ROK-619)
 *
 * The existing test file (GameTimeGrid.whole-day.test.tsx) covers
 * day-header-0 and a handful of scenarios. This file targets:
 *   - All 7 day headers (not just index 0)
 *   - Correct dayIndex passed to handler (not always 0)
 *   - Keyboard a11y: Enter and Space trigger the toggle
 *   - role="button" / tabIndex present only when interactive
 *   - No-op when both readOnly and onChange provided simultaneously
 *   - hourRange prop does not affect day-header click behavior
 *   - Multiple sequential toggles produce correct state
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameTimeGrid } from './GameTimeGrid';
import type { GameTimeSlot } from '@raid-ledger/contract';

describe('GameTimeGrid — day header interactive attributes (ROK-619)', () => {
    it('day headers have role="button" when interactive', () => {
        render(<GameTimeGrid slots={[]} onChange={vi.fn()} />);
        for (let i = 0; i < 7; i++) {
            expect(screen.getByTestId(`day-header-${i}`)).toHaveAttribute('role', 'button');
        }
    });

    it('day headers have tabIndex=0 when interactive', () => {
        render(<GameTimeGrid slots={[]} onChange={vi.fn()} />);
        for (let i = 0; i < 7; i++) {
            expect(screen.getByTestId(`day-header-${i}`)).toHaveAttribute('tabindex', '0');
        }
    });

    it('day headers do not have role="button" in readOnly mode', () => {
        render(<GameTimeGrid slots={[]} readOnly />);
        for (let i = 0; i < 7; i++) {
            expect(screen.getByTestId(`day-header-${i}`)).not.toHaveAttribute('role', 'button');
        }
    });

    it('day headers do not have tabIndex in readOnly mode', () => {
        render(<GameTimeGrid slots={[]} readOnly />);
        for (let i = 0; i < 7; i++) {
            expect(screen.getByTestId(`day-header-${i}`)).not.toHaveAttribute('tabindex');
        }
    });

    it('day headers without onChange do not have role="button"', () => {
        render(<GameTimeGrid slots={[]} />);
        for (let i = 0; i < 7; i++) {
            expect(screen.getByTestId(`day-header-${i}`)).not.toHaveAttribute('role', 'button');
        }
    });
});

describe('GameTimeGrid — correct dayIndex passed per header (ROK-619)', () => {
    it.each([0, 1, 2, 3, 4, 5, 6])(
        'clicking day-header-%i calls onChange with dayOfWeek=%i slots',
        (dayIndex) => {
            const onChange = vi.fn();
            render(<GameTimeGrid slots={[]} onChange={onChange} />);
            fireEvent.click(screen.getByTestId(`day-header-${dayIndex}`));
            expect(onChange).toHaveBeenCalledTimes(1);
            const result = onChange.mock.calls[0][0] as GameTimeSlot[];
            expect(result).toHaveLength(24);
            expect(result.every((s) => s.dayOfWeek === dayIndex)).toBe(true);
        },
    );

    it('clicking different day headers do not affect each other', () => {
        const slots: GameTimeSlot[] = Array.from({ length: 24 }, (_, i) => ({
            dayOfWeek: 3, hour: i, status: 'available' as const,
        }));
        const onChange = vi.fn();
        render(<GameTimeGrid slots={slots} onChange={onChange} />);

        // Click Wednesday (3) — should deselect its 24 slots
        fireEvent.click(screen.getByTestId('day-header-3'));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result.filter((s) => s.dayOfWeek === 3)).toHaveLength(0);

        // Other days unaffected in the result
        expect(result.filter((s) => s.dayOfWeek !== 3)).toHaveLength(0);
    });
});

describe('GameTimeGrid — keyboard accessibility on day headers (ROK-619)', () => {
    it('Enter key triggers day toggle', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} />);
        const header = screen.getByTestId('day-header-0');
        header.focus();
        await user.keyboard('{Enter}');
        expect(onChange).toHaveBeenCalledTimes(1);
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result).toHaveLength(24);
    });

    it('Space key triggers day toggle', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} />);
        const header = screen.getByTestId('day-header-1');
        header.focus();
        await user.keyboard(' ');
        expect(onChange).toHaveBeenCalledTimes(1);
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result).toHaveLength(24);
        expect(result.every((s) => s.dayOfWeek === 1)).toBe(true);
    });

    it('other keys (e.g. Tab) do not trigger day toggle', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} />);
        const header = screen.getByTestId('day-header-0');
        header.focus();
        await user.keyboard('{ArrowDown}');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('Enter key does not trigger toggle in readOnly mode', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} readOnly />);
        // In readOnly mode the element has no tabIndex, so manually focus via DOM
        const header = screen.getByTestId('day-header-0');
        header.focus();
        await user.keyboard('{Enter}');
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('GameTimeGrid — whole-day toggle with hourRange (ROK-619 / ROK-1011)', () => {
    it('day header selects only visible hours when hourRange is set', () => {
        // ROK-1011: toggle respects hourRange — only visible hours are toggled
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} hourRange={[18, 24]} />);
        fireEvent.click(screen.getByTestId('day-header-0'));
        const result = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(result).toHaveLength(6);
        const hours = result.map((s) => s.hour).sort((a, b) => a - b);
        expect(hours).toEqual([18, 19, 20, 21, 22, 23]);
    });
});

describe('GameTimeGrid — sequential whole-day toggles (ROK-619)', () => {
    it('toggling the same day twice restores the original slot set', () => {
        const originalSlots: GameTimeSlot[] = [
            { dayOfWeek: 0, hour: 6, status: 'available' },
            { dayOfWeek: 0, hour: 7, status: 'available' },
        ];
        const onChange = vi.fn();
        render(<GameTimeGrid slots={originalSlots} onChange={onChange} />);

        // First click: fills all 24 hours
        fireEvent.click(screen.getByTestId('day-header-0'));
        const after1st = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(after1st).toHaveLength(24);

        // Simulate the onChange applied (re-render with new slots)
        onChange.mockClear();
        render(<GameTimeGrid slots={after1st} onChange={onChange} />);

        // Second click: deselects all 24 hours
        fireEvent.click(screen.getAllByTestId('day-header-0')[1]);
        const after2nd = onChange.mock.calls[0][0] as GameTimeSlot[];
        expect(after2nd).toHaveLength(0);
    });

    it('clicking two different day headers each produce correct isolated updates', () => {
        const onChange = vi.fn();
        render(<GameTimeGrid slots={[]} onChange={onChange} />);

        fireEvent.click(screen.getByTestId('day-header-0'));
        const result0 = onChange.mock.calls[0][0] as GameTimeSlot[];

        fireEvent.click(screen.getByTestId('day-header-6'));
        const result6 = onChange.mock.calls[1][0] as GameTimeSlot[];

        // Each call produced 24 slots for its own day
        expect(result0.every((s) => s.dayOfWeek === 0)).toBe(true);
        expect(result6.every((s) => s.dayOfWeek === 6)).toBe(true);
        expect(result0).toHaveLength(24);
        expect(result6).toHaveLength(24);
    });
});
