/**
 * ROK-1646 — Checkbox (spike ROK-1644 §4.5): a native checkbox, the label
 * slot as the 44px target, description, indeterminate, and Field use.
 */
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './checkbox';
import { Field } from './field';

describe('Checkbox — standalone', () => {
    it('is a native 20px checkbox on the success accent, named by its label', () => {
        render(<Checkbox label="Notify me" />);
        expect(screen.getByRole('checkbox', { name: 'Notify me' })).toHaveClass(
            'w-5', 'h-5', 'accent-success', 'focus-visible:ring-success/80',
        );
    });

    it('the whole label row is the 44px target', async () => {
        const onChange = vi.fn();
        render(<Checkbox label="Notify me" onChange={onChange} />);
        const row = screen.getByText('Notify me').closest('label');
        expect(row).toHaveClass('min-h-[44px]', 'cursor-pointer');
        await userEvent.click(screen.getByText('Notify me'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('checkbox', { name: 'Notify me' })).toBeChecked();
    });

    it('description is linked by aria-describedby', () => {
        render(<Checkbox label="Public" description="Anyone with the link can view." />);
        expect(screen.getByRole('checkbox', { name: 'Public' })).toHaveAccessibleDescription(
            'Anyone with the link can view.',
        );
    });

    it('indeterminate sets the mixed state and clears when turned off', () => {
        const { rerender } = render(<Checkbox label="All" indeterminate onChange={() => undefined} checked={false} />);
        expect(screen.getByRole('checkbox', { name: 'All' })).toBePartiallyChecked();
        rerender(<Checkbox label="All" onChange={() => undefined} checked={false} />);
        expect(screen.getByRole('checkbox', { name: 'All' })).not.toBePartiallyChecked();
    });

    it('forwards its ref even while indeterminate', () => {
        const ref = createRef<HTMLInputElement>();
        render(<Checkbox label="All" indeterminate ref={ref} />);
        expect(ref.current).toBe(screen.getByRole('checkbox', { name: 'All' }));
        expect(ref.current?.indeterminate).toBe(true);
    });

    it('disabled uses the single opacity treatment', () => {
        render(<Checkbox label="Locked" disabled />);
        const box = screen.getByRole('checkbox', { name: 'Locked' });
        expect(box).toBeDisabled();
        expect(box).toHaveClass('disabled:opacity-50');
    });
});

describe('Checkbox — inside a Field', () => {
    it('takes the Field label, error and required through context', () => {
        render(<Field label="Accept the rules" error="You must accept" required><Checkbox /></Field>);
        const box = screen.getByRole('checkbox', { name: 'Accept the rules' });
        expect(box).toHaveAttribute('aria-invalid', 'true');
        expect(box).toHaveAttribute('aria-required', 'true');
        expect(box).toHaveAccessibleDescription('You must accept');
    });
});
