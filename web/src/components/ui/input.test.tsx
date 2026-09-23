/**
 * ROK-1646 — Input (spike ROK-1644 §4.3): the shared field frame, fieldSize,
 * leading/trailing adornments, mono, invalid, the forwarded ref, and the
 * Field context wiring end to end.
 */
import { createRef } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './input';
import { Field } from './field';

describe('Input — frame and sizes', () => {
    it('renders the token frame: 44px, 16px text below lg, rounded-lg, success focus ring', () => {
        render(<Input aria-label="Name" />);
        expect(screen.getByRole('textbox', { name: 'Name' })).toHaveClass(
            'min-h-[44px]', 'text-base', 'lg:text-sm', 'bg-panel', 'border-edge', 'rounded-lg',
            'placeholder:text-dim', 'focus-visible:ring-success/80', 'px-3', 'py-2',
        );
    });

    it.each([
        ['lg', ['px-4', 'py-3']],
        ['sm', ['min-h-[44px]', 'lg:min-h-9', 'lg:px-2', 'lg:py-1']],
    ] as const)('fieldSize %s applies its padding and keeps the 44px floor below lg', (fieldSize, classes) => {
        render(<Input aria-label="N" fieldSize={fieldSize} />);
        expect(screen.getByRole('textbox', { name: 'N' })).toHaveClass(...classes);
    });

    it('does not clash with the native numeric size attribute', () => {
        render(<Input aria-label="N" fieldSize="lg" />);
        expect(screen.getByRole('textbox', { name: 'N' })).not.toHaveAttribute('size');
    });

    it('mono switches to font-mono', () => {
        render(<Input aria-label="N" mono />);
        expect(screen.getByRole('textbox', { name: 'N' })).toHaveClass('font-mono');
    });

    it('invalid sets aria-invalid, which paints the danger border', () => {
        render(<Input aria-label="N" invalid />);
        const input = screen.getByRole('textbox', { name: 'N' });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveClass('aria-[invalid=true]:border-danger');
    });

    it('disabled uses the single opacity treatment', () => {
        render(<Input aria-label="N" disabled />);
        const input = screen.getByRole('textbox', { name: 'N' });
        expect(input).toBeDisabled();
        expect(input).toHaveClass('disabled:opacity-50');
    });
});

describe('Input — adornments and ref', () => {
    it('leading renders an icon slot and pads the text past it', () => {
        render(<Input aria-label="N" leading={<svg data-testid="lead" />} />);
        expect(screen.getByTestId('lead')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'N' })).toHaveClass('pl-10');
    });

    it('trailing renders an interactive slot and pads the text before it', async () => {
        render(<Input aria-label="N" trailing={<button type="button">Show</button>} />);
        expect(screen.getByRole('button', { name: 'Show' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'N' })).toHaveClass('pr-12');
    });

    it('forwards its ref to the <input>', () => {
        const ref = createRef<HTMLInputElement>();
        render(<Input aria-label="N" ref={ref} />);
        expect(ref.current).toBe(screen.getByRole('textbox', { name: 'N' }));
    });

    it('passes native attributes through', () => {
        render(<Input aria-label="N" type="email" placeholder="you@example.com" maxLength={20} />);
        const input = screen.getByRole('textbox', { name: 'N' });
        expect(input).toHaveAttribute('type', 'email');
        expect(input).toHaveAttribute('maxlength', '20');
    });
});

describe('Input inside Field', () => {
    it('clicking the label focuses the input', async () => {
        render(<Field label="Event name"><Input /></Field>);
        await userEvent.click(screen.getByText('Event name'));
        expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveFocus();
    });

    it('the error is linked by aria-describedby and sets aria-invalid', () => {
        render(<Field label="Event name" error="Required"><Input /></Field>);
        const input = screen.getByRole('textbox', { name: 'Event name' });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAccessibleDescription('Required');
        expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    });

    it('required on the Field sets aria-required on the input', () => {
        render(<Field label="Event name" required><Input /></Field>);
        expect(screen.getByRole('textbox', { name: 'Event name' })).toHaveAttribute('aria-required', 'true');
    });
});
