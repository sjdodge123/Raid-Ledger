/** Day pager header for the phone week editor (ROK-1569). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DayPager } from '../DayPager';

describe('DayPager', () => {
    it('names the day and how much of it is free', () => {
        render(<DayPager day={2} freeHours={3} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Tuesday');
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('3h free');
    });

    it('says "nothing yet" rather than "0h free" on an empty day', () => {
        render(<DayPager day={2} freeHours={0} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('nothing yet');
    });

    it('steps with the arrows', () => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(<DayPager day={2} freeHours={0} onPrev={onPrev} onNext={onNext} />);
        fireEvent.click(screen.getByLabelText('Previous day'));
        fireEvent.click(screen.getByLabelText('Next day'));
        expect(onPrev).toHaveBeenCalledTimes(1);
        expect(onNext).toHaveBeenCalledTimes(1);
    });

    it('disables the arrow that would run off the end of the week', () => {
        const { unmount } = render(<DayPager day={0} freeHours={0} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByLabelText('Previous day')).toBeDisabled();
        expect(screen.getByLabelText('Next day')).toBeEnabled();
        unmount();
        render(<DayPager day={6} freeHours={0} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByLabelText('Next day')).toBeDisabled();
    });
});
