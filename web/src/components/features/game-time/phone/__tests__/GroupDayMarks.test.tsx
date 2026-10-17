/**
 * The marks drawn over the phone's group day (ROK-1587): the viewer's own events
 * as titled blocks (operator ruling 2026-09-17), and each already-suggested poll
 * slot as a dashed block with an "N voted" chip.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DayEventBlock, SlotBlock } from '../GroupDayMarks';
import { blockGeometry } from '../group-day.utils';

const HOURS = [17, 18, 19, 20, 21, 22, 23];

describe('blockGeometry', () => {
    it('is a percentage of the visible hours', () => {
        expect(blockGeometry(2, 5, 7)).toEqual({ top: `${(2 / 7) * 100}%`, height: `${(3 / 7) * 100}%` });
    });
});

describe('DayEventBlock', () => {
    it('is a titled block spanning the event\'s hours, left of the counts', () => {
        const event = {
            eventId: 7, title: 'Raid night', gameSlug: null, gameName: null, coverUrl: null, signupId: 1,
            confirmationStatus: 'confirmed' as const, dayOfWeek: 3, startHour: 19, endHour: 22,
        };
        render(<DayEventBlock event={event} range={{ startIndex: 2, endIndex: 5 }} hours={HOURS} />);
        const block = screen.getByTestId('phone-group-event-7');
        expect(block).toHaveTextContent('Raid night');
        expect(block).toHaveAttribute('data-start-hour', '19');
        expect(block.className).toContain('w-[55%]');
        expect(block.style.top).toBe(`${(2 / 7) * 100}%`);
        expect(block.style.height).toBe(`${(3 / 7) * 100}%`);
    });
});

describe('SlotBlock', () => {
    it('draws a dashed slot-colour block on its start hour, one row tall', () => {
        render(<SlotBlock mark={{ dayOfWeek: 3, hour: 20, votes: 2 }} hours={HOURS} />);
        const block = screen.getByTestId('phone-group-slot-block-20');
        expect(block.style.top).toBe(`${(3 / 7) * 100}%`);
        expect(block.style.height).toBe(`${(1 / 7) * 100}%`);
        expect(block.className).toContain('border-dashed');
        expect(block.className).toContain('border-slot');
        expect(block.className).toContain('bg-slot/10');
    });

    it('carries an "N voted" chip at its bottom-right', () => {
        render(<SlotBlock mark={{ dayOfWeek: 3, hour: 20, votes: 2 }} hours={HOURS} />);
        const chip = screen.getByTestId('phone-group-slot-chip');
        expect(chip).toHaveTextContent(/^2 voted$/);
        expect(chip.className).toContain('bottom-1');
        expect(chip.className).toContain('right-1.5');
        expect(chip.className).toContain('text-slot');
    });

    it('still reads "0 voted" for a slot nobody has voted on (Q6)', () => {
        render(<SlotBlock mark={{ dayOfWeek: 3, hour: 18, votes: 0 }} hours={HOURS} />);
        expect(screen.getByTestId('phone-group-slot-chip')).toHaveTextContent(/^0 voted$/);
    });

    it('draws nothing for a slot outside the visible hours', () => {
        const { container } = render(<SlotBlock mark={{ dayOfWeek: 3, hour: 9, votes: 1 }} hours={HOURS} />);
        expect(container).toBeEmptyDOMElement();
    });
});
