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

  it('renders pulse animation dot with nested spans', () => {
    render(<LiveBadge />);

    const badge = screen.getByLabelText('Live event');
    // The pulse dot is a container span with two nested spans (ping + solid dot)
    const dotContainer = badge.querySelector('span > span');
    expect(dotContainer).toBeInTheDocument();
    // Two child spans inside the dot container: the ping layer and the solid dot
    const childSpans = dotContainer?.querySelectorAll('span');
    expect(childSpans?.length).toBe(2);
  });

  it('accepts custom className', () => {
    render(<LiveBadge className="ml-2" />);

    const badge = screen.getByLabelText('Live event');
    expect(badge).toHaveClass('ml-2');
  });

  it('renders without className prop', () => {
    render(<LiveBadge />);

    const badge = screen.getByLabelText('Live event');
    expect(badge).toBeInTheDocument();
  });
});
