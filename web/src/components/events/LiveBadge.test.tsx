import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveBadge } from './LiveBadge';

describe('LiveBadge', () => {
  it('renders "LIVE" text', () => {
    render(<LiveBadge />);

    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });

  it('has aria-label for accessibility', () => {
    render(<LiveBadge />);

    expect(screen.getByLabelText('Live event')).toBeInTheDocument();
  });

  it('renders pulse animation dot', () => {
    const { container } = render(<LiveBadge />);

    // The ping animation span should exist
    const pulseSpan = container.querySelector('.animate-ping');
    expect(pulseSpan).toBeInTheDocument();
  });

  it('accepts custom className', () => {
    render(<LiveBadge className="ml-2" />);

    const badge = screen.getByLabelText('Live event');
    expect(badge).toHaveClass('ml-2');
  });

  it('applies default styling classes', () => {
    render(<LiveBadge />);

    const badge = screen.getByLabelText('Live event');
    expect(badge).toHaveClass('inline-flex');
    expect(badge).toHaveClass('items-center');
    expect(badge).toHaveClass('text-xs');
    expect(badge).toHaveClass('font-semibold');
    expect(badge).toHaveClass('rounded-full');
  });

  it('renders without className prop', () => {
    render(<LiveBadge />);

    const badge = screen.getByLabelText('Live event');
    expect(badge).toBeInTheDocument();
  });
});
