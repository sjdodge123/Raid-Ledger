/**
 * ROK-1655 PR-1 — PasswordInput (audit ROK-1644 §4.3, plan ruling 2): the
 * shared Input with a ghost icon-only show/hide Button named
 * "Show/Hide <label>", uncontrolled by default, controlled by `revealed`.
 */
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PasswordInput } from './password-input';
import { Field } from './field';

describe('PasswordInput — uncontrolled', () => {
    it('defaults to type=password with a toggle named "Show <label>"', () => {
        render(<PasswordInput label="Password" aria-label="Password" />);
        expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
        expect(screen.getByRole('button', { name: 'Show Password' })).toBeInTheDocument();
    });

    it('a click reveals the text and renames the toggle "Hide <label>"', async () => {
        const onRevealedChange = vi.fn();
        render(<PasswordInput label="Password" aria-label="Password" onRevealedChange={onRevealedChange} />);
        await userEvent.click(screen.getByRole('button', { name: 'Show Password' }));
        expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
        expect(screen.getByRole('button', { name: 'Hide Password' })).toBeInTheDocument();
        expect(onRevealedChange).toHaveBeenCalledWith(true);
        await userEvent.click(screen.getByRole('button', { name: 'Hide Password' }));
        expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    });

    it('the toggle is a ghost icon-only button that controls the input and never submits', () => {
        render(<PasswordInput label="Password" aria-label="Password" id="pw" />);
        const toggle = screen.getByRole('button', { name: 'Show Password' });
        expect(toggle).toHaveAttribute('aria-controls', 'pw');
        expect(toggle).toHaveAttribute('type', 'button');
        expect(toggle).toHaveClass('min-w-[44px]', 'text-muted');
        expect(screen.getByLabelText('Password')).toHaveClass('pr-14');
    });
});

describe('PasswordInput — controlled', () => {
    it('revealed={true} renders text; a click only calls onRevealedChange(false)', async () => {
        const onRevealedChange = vi.fn();
        const { rerender } = render(
            <PasswordInput label="API key" aria-label="API key" revealed onRevealedChange={onRevealedChange} />,
        );
        expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'text');
        await userEvent.click(screen.getByRole('button', { name: 'Hide API key' }));
        expect(onRevealedChange).toHaveBeenCalledWith(false);
        expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'text');
        rerender(
            <PasswordInput label="API key" aria-label="API key" revealed={false} onRevealedChange={onRevealedChange} />,
        );
        expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password');
        expect(screen.getByRole('button', { name: 'Show API key' })).toBeInTheDocument();
    });
});

describe('PasswordInput — Field wiring, ref and a11y', () => {
    it('inside a Field the label finds the input, the hint describes it, and the toggle controls its id', () => {
        render(
            <Field label="Password" hint="At least 12 characters" required>
                <PasswordInput label="password" />
            </Field>,
        );
        const input = screen.getByLabelText(/^Password/);
        expect(input).toHaveAttribute('type', 'password');
        expect(input).toHaveAccessibleDescription('At least 12 characters');
        expect(input).toHaveAttribute('aria-required', 'true');
        expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-controls', input.id);
    });

    it('forwards its ref to the <input>', () => {
        const ref = createRef<HTMLInputElement>();
        render(<PasswordInput label="Password" aria-label="Password" ref={ref} />);
        expect(ref.current).toBe(screen.getByLabelText('Password'));
    });

    it('has no axe violations inside a Field, hidden and revealed', async () => {
        const { container } = render(
            <Field label="Password" hint="Hint" error="Too short">
                <PasswordInput label="password" />
            </Field>,
        );
        expect(await axe(container)).toHaveNoViolations();
        await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
        expect(await axe(container)).toHaveNoViolations();
    });
});
