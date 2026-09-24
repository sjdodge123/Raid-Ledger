/**
 * ROK-1588 (Q8) — the suggest form is the "Find a better time" footer CTA, so
 * its button names the time it will submit, derived from its own value.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SchedulingSuggestForm } from '../SchedulingSuggestForm';
import { suggestButtonLabel } from '../scheduling-availability';

describe('SchedulingSuggestForm CTA label (ROK-1588)', () => {
    it('reads "Suggest Wed 9 PM" for a prefilled cell pick', () => {
        render(<SchedulingSuggestForm prefillTime="2026-09-16T21:00" isSuggesting={false} onSuggest={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Suggest Wed 9 PM' })).toBeEnabled();
    });

    it('reads plain "Suggest" (disabled) with no value', () => {
        render(<SchedulingSuggestForm isSuggesting={false} onSuggest={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Suggest' })).toBeDisabled();
    });

    it('follows a typed time and submits it', () => {
        const onSuggest = vi.fn();
        render(<SchedulingSuggestForm isSuggesting={false} onSuggest={onSuggest} />);
        fireEvent.change(screen.getByTestId('slot-datetime-picker'), { target: { value: '2026-09-20T12:00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Suggest Sun 12 PM' }));
        expect(onSuggest).toHaveBeenCalledWith(new Date('2026-09-20T12:00').toISOString());
    });

    it('falls back to "Suggest" for an unparseable value', () => {
        expect(suggestButtonLabel('not-a-date')).toBe('Suggest');
        expect(suggestButtonLabel('')).toBe('Suggest');
        expect(suggestButtonLabel('2026-09-17T00:00')).toBe('Suggest Thu 12 AM');
    });
});

describe('SchedulingSuggestForm wears the shared Field / Input / Button (ROK-1650)', () => {
    it('names the picker through a Field label linked by for/id, testid still on the <input>', () => {
        render(<SchedulingSuggestForm isSuggesting={false} onSuggest={vi.fn()} />);
        const picker = screen.getByTestId('slot-datetime-picker');
        // The smoke specs locate `[data-testid="slot-datetime-picker"]` and
        // `input[type="datetime-local"]` — both must stay on the native input.
        expect(picker.tagName).toBe('INPUT');
        expect(picker).toHaveAttribute('type', 'datetime-local');
        expect(picker.id, 'the Field must give the picker an id its label points at').not.toBe('');
        const label = screen.getByText('Suggest another time');
        expect(label.tagName).toBe('LABEL');
        expect(label).toHaveAttribute('for', picker.id);
        expect(screen.getByLabelText('Suggest another time')).toBe(picker);
    });

    it('gives the picker and the Suggest button the 44px tap target, with no raw emerald on the picker', () => {
        render(<SchedulingSuggestForm prefillTime="2026-09-16T21:00" isSuggesting={false} onSuggest={vi.fn()} />);
        const picker = screen.getByTestId('slot-datetime-picker');
        expect(picker).toHaveClass('min-h-[44px]');
        expect(picker.className).not.toMatch(/emerald/);
        expect(screen.getByRole('button', { name: 'Suggest Wed 9 PM' })).toHaveClass('min-h-[44px]');
    });
});
