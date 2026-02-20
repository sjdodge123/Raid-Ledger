import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PluginBadge } from './plugin-badge';

describe('PluginBadge', () => {
    it('renders the icon', () => {
        render(<PluginBadge icon="WoW" color="blue" label="Test Plugin" />);
        expect(screen.getByText('WoW')).toBeInTheDocument();
    });

    it('shows label as title tooltip', () => {
        render(<PluginBadge icon="X" color="blue" label="My Plugin" />);
        const badge = screen.getByLabelText('My Plugin');
        expect(badge).toHaveAttribute('title', 'My Plugin');
    });

    it('applies known color classes for blue', () => {
        const { container } = render(
            <PluginBadge icon="B" color="blue" label="Blue" />,
        );
        const span = container.querySelector('span');
        expect(span?.className).toContain('bg-blue-500/20');
        expect(span?.className).toContain('text-blue-400');
        expect(span?.className).toContain('border-blue-500/30');
    });

    it('applies known color classes for amber', () => {
        const { container } = render(
            <PluginBadge icon="A" color="amber" label="Amber" />,
        );
        const span = container.querySelector('span');
        expect(span?.className).toContain('bg-amber-500/20');
        expect(span?.className).toContain('text-amber-400');
    });

    it('falls back to gray for unknown color', () => {
        const { container } = render(
            <PluginBadge icon="?" color="chartreuse" label="Unknown" />,
        );
        const span = container.querySelector('span');
        expect(span?.className).toContain('bg-gray-500/20');
        expect(span?.className).toContain('text-gray-400');
    });

    it('has aria-label for accessibility', () => {
        render(<PluginBadge icon="X" color="red" label="Accessible" />);
        expect(screen.getByLabelText('Accessible')).toBeInTheDocument();
    });

    it('marks icon as aria-hidden', () => {
        const { container } = render(
            <PluginBadge icon="Z" color="emerald" label="Test" />,
        );
        const iconSpan = container.querySelector('[aria-hidden="true"]');
        expect(iconSpan).toBeInTheDocument();
        expect(iconSpan?.textContent).toBe('Z');
    });

    it('renders as a small pill with rounded-full', () => {
        const { container } = render(
            <PluginBadge icon="P" color="purple" label="Pill" />,
        );
        const span = container.querySelector('span');
        expect(span?.className).toContain('rounded-full');
    });
});
