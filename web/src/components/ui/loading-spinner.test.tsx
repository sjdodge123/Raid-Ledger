import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingSpinner } from './loading-spinner';

describe('LoadingSpinner', () => {
    it('renders without crashing', () => {
        const { container } = render(<LoadingSpinner />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('renders a spinning element', () => {
        const { container } = render(<LoadingSpinner />);
        const spinner = container.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
    });

    it('renders outer centering wrapper', () => {
        const { container } = render(<LoadingSpinner />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper).toHaveClass('flex', 'items-center', 'justify-center');
    });

    it('wrapper has min-h-[60vh] for full-page centering', () => {
        const { container } = render(<LoadingSpinner />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.className).toContain('min-h-');
    });

    it('spinner is a div with rounded-full for circular shape', () => {
        const { container } = render(<LoadingSpinner />);
        const spinner = container.querySelector('.animate-spin');
        expect(spinner?.tagName).toBe('DIV');
        expect(spinner).toHaveClass('rounded-full');
    });

    it('spinner has border styling', () => {
        const { container } = render(<LoadingSpinner />);
        const spinner = container.querySelector('.animate-spin');
        expect(spinner).toHaveClass('border-4');
    });

    it('spinner has emerald top-border accent color', () => {
        const { container } = render(<LoadingSpinner />);
        const spinner = container.querySelector('.animate-spin');
        expect(spinner?.className).toContain('border-t-emerald');
    });

    it('renders single spinner element (no extra markup)', () => {
        const { container } = render(<LoadingSpinner />);
        const spinners = container.querySelectorAll('.animate-spin');
        expect(spinners.length).toBe(1);
    });

    it('does not render any text content', () => {
        render(<LoadingSpinner />);
        // Spinner is purely visual — no text expected
        expect(screen.queryByText(/.+/)).toBeNull();
    });
});
