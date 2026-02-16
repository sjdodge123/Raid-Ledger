import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FAB } from './fab';
import { PlusIcon, FunnelIcon } from '@heroicons/react/24/solid';

// Mock useScrollDirection hook
vi.mock('../../hooks/use-scroll-direction', () => ({
    useScrollDirection: vi.fn(() => null),
}));

import { useScrollDirection } from '../../hooks/use-scroll-direction';

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

    it('has 56px size (w-14 h-14)', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('w-14', 'h-14');
    });

    it('has emerald background and white text', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('bg-emerald-600', 'text-white');
    });

    it('has active:scale-95 for tap feedback', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('active:scale-95');
    });

    it('has md:hidden class for mobile-only visibility', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('md:hidden');
    });

    it('applies z-index 30 from Z_INDEX.FAB', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveStyle({ zIndex: 30 });
    });

    it('positions at bottom-[72px] when tab bar visible (scroll direction null)', () => {
        vi.mocked(useScrollDirection).mockReturnValue(null);
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('bottom-[72px]');
        expect(button).not.toHaveClass('bottom-4');
    });

    it('positions at bottom-[72px] when scrolling up', () => {
        vi.mocked(useScrollDirection).mockReturnValue('up');
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('bottom-[72px]');
        expect(button).not.toHaveClass('bottom-4');
    });

    it('positions at bottom-4 when tab bar hidden (scroll direction down)', () => {
        vi.mocked(useScrollDirection).mockReturnValue('down');
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('bottom-4');
        expect(button).not.toHaveClass('bottom-[72px]');
    });

    it('has fixed positioning on the right', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('fixed', 'right-4');
    });

    it('has rounded-full shape', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('rounded-full');
    });

    it('has shadow-lg with emerald glow', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('shadow-lg', 'shadow-emerald-500/25');
    });

    it('has hover:bg-emerald-500 state', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        expect(button).toHaveClass('hover:bg-emerald-500');
    });

    it('has proper accessibility label', () => {
        render(<FAB onClick={() => {}} label="Create Event" />);
        const button = screen.getByRole('button', { name: 'Create Event' });
        expect(button).toHaveAttribute('aria-label', 'Create Event');
    });

    it('icon has w-6 h-6 size (24px)', () => {
        render(<FAB onClick={() => {}} />);
        const button = screen.getByRole('button');
        const svg = button.querySelector('svg');
        expect(svg).toHaveClass('w-6', 'h-6');
    });
});
