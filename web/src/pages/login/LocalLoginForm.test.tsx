import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LocalLoginForm } from './LocalLoginForm';

describe('LocalLoginForm (ROK-1645)', () => {
    it('announces the login error to assistive tech as an alert', () => {
        render(<LocalLoginForm onSubmit={vi.fn()} isLoading={false} error="Invalid username or password" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid username or password');
    });

    it('renders no alert when there is no error', () => {
        render(<LocalLoginForm onSubmit={vi.fn()} isLoading={false} error={null} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('LocalLoginForm on the form primitives (ROK-1648)', () => {
    it('keeps the #username / #password ids the auth smoke uses, resolved through Field', () => {
        render(<LocalLoginForm onSubmit={vi.fn()} isLoading={false} error={null} />);
        expect(screen.getByLabelText('Username')).toHaveAttribute('id', 'username');
        expect(screen.getByLabelText('Password')).toHaveAttribute('id', 'password');
        // Field names its label `${id}-label`; a hand-rolled <label> has no id.
        expect(document.querySelector('label[for="username"]')).toHaveAttribute('id', 'username-label');
        expect(document.querySelector('label[for="password"]')).toHaveAttribute('id', 'password-label');
    });

    it('names the password reveal toggle "Show Password" / "Hide Password" and flips the type', async () => {
        render(<LocalLoginForm onSubmit={vi.fn()} isLoading={false} error={null} />);
        const input = screen.getByLabelText('Password');
        expect(input).toHaveAttribute('type', 'password');
        await userEvent.click(screen.getByRole('button', { name: 'Show Password' }));
        expect(input).toHaveAttribute('type', 'text');
        expect(screen.getByRole('button', { name: 'Hide Password' })).toHaveAttribute('aria-controls', 'password');
    });

    it('submits the typed credentials from the "Sign In" button', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<LocalLoginForm onSubmit={onSubmit} isLoading={false} error={null} />);
        await userEvent.type(screen.getByLabelText('Username'), 'admin@local');
        await userEvent.type(screen.getByLabelText('Password'), 'hunter2');
        await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));
        expect(onSubmit).toHaveBeenCalledWith('admin@local', 'hunter2');
    });

    // Ruling 7: equal strength to the old native `disabled` — busy, aria-disabled, and a click submits nothing.
    it('marks the submit busy + aria-disabled while loading and swallows a click', () => {
        const onSubmit = vi.fn();
        render(<LocalLoginForm onSubmit={onSubmit} isLoading error={null} />);
        const submit = screen.getByRole('button', { name: 'Signing in...' });
        expect(submit).toHaveAttribute('type', 'submit');
        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(submit).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(submit);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('paints the error alert with the danger token, not a raw red', () => {
        render(<LocalLoginForm onSubmit={vi.fn()} isLoading={false} error="Nope" />);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveClass('text-danger');
        expect(alert.className).not.toMatch(/red-/);
    });
});
