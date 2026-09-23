import { render, screen } from '@testing-library/react';
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
