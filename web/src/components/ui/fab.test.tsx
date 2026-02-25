import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FAB } from './fab';
import { FunnelIcon } from '@heroicons/react/24/solid';

// Mock useScrollDirection hook
vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: vi.fn(() => null),
}));

describe('FAB', () => {
    it('renders with default plus icon', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button', { name: 'Create' });
        expect(button).toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
        const handleClick = vi.fn();
        render(<FAB onClick={handleClick} />);

        const button = screen.getByRole('button');
        fireEvent.click(button);

        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders custom icon when provided', () => {
        render(<FAB onClick={() => {}} icon={FunnelIcon} />);
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
    });

    it('uses custom label when provided', () => {
        render(<FAB onClick={() => {}} label="Filter by Game" />);
        const button = screen.getByRole('button', { name: 'Filter by Game' });
        expect(button).toBeInTheDocument();
    });

    it('has proper accessibility label', () => {
        render(<FAB onClick={() => {}} label="Create Event" />);
        const button = screen.getByRole('button', { name: 'Create Event' });
        expect(button).toHaveAttribute('aria-label', 'Create Event');
    });

});
