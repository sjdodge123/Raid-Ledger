/**
 * The marks drawn over the phone's group day (ROK-1587): the viewer's own game
 * time as a solid bar at the row's left edge, and each already-suggested poll
 * slot as a dashed block with an "N voted" chip.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlotBlock, YouBar } from '../GroupDayMarks';
import { blockGeometry } from '../group-day.utils';

const HOURS = [17, 18, 19, 20, 21, 22, 23];

describe('blockGeometry', () => {
    it('is a percentage of the visible hours', () => {
        expect(blockGeometry(2, 5, 7)).toEqual({ top: `${(2 / 7) * 100}%`, height: `${(3 / 7) * 100}%` });
    });
});

describe('YouBar', () => {
    it('is a solid, text-free, aria-hidden bar spanning the block', () => {
        render(<YouBar block={{ startIndex: 2, endIndex: 5 }} hours={HOURS} />);
        const bar = screen.getByTestId('phone-group-you-bar');
        expect(bar).toHaveAttribute('aria-hidden', 'true');
        expect(bar).toHaveTextContent('');
        expect(bar.className).toContain('left-0');
        expect(bar.className).toContain('w-1');
        expect(bar.className).toContain('bg-foreground/70');
        expect(bar.className).not.toContain('border-dashed');
        expect(bar.style.top).toBe(`${(2 / 7) * 100}%`);
        expect(bar.style.height).toBe(`${(3 / 7) * 100}%`);
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
