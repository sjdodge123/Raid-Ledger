/**
 * Tests for VisibilityToggle (ROK-1065).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisibilityToggle } from './VisibilityToggle';

describe('VisibilityToggle', () => {
  it('renders both options with the current value marked active', () => {
    render(<VisibilityToggle value="public" onChange={() => {}} />);
    const publicBtn = screen.getByTestId('visibility-public');
    const privateBtn = screen.getByTestId('visibility-private');
    expect(publicBtn.getAttribute('aria-checked')).toBe('true');
    expect(privateBtn.getAttribute('aria-checked')).toBe('false');
  });

  it('calls onChange when a different option is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VisibilityToggle value="public" onChange={onChange} />);
    await user.click(screen.getByTestId('visibility-private'));
    expect(onChange).toHaveBeenCalledWith('private');
  });

  it('updates the description text based on the current value', () => {
    const { rerender } = render(
      <VisibilityToggle value="public" onChange={() => {}} />,
    );
    expect(
      screen.getByText(/every community member/i),
    ).toBeInTheDocument();
    rerender(<VisibilityToggle value="private" onChange={() => {}} />);
    expect(
      screen.getByText(/only invited users/i),
    ).toBeInTheDocument();
  });

  it('gives both radios a 44px tap target and paints the checked one with its status token', () => {
    const { rerender } = render(<VisibilityToggle value="public" onChange={() => {}} />);
    expect(screen.getByTestId('visibility-public')).toHaveClass('min-h-[44px]', 'bg-success/15', 'border-success');
    expect(screen.getByTestId('visibility-private')).toHaveClass('min-h-[44px]', 'border-edge');
    rerender(<VisibilityToggle value="private" onChange={() => {}} />);
    expect(screen.getByTestId('visibility-private')).toHaveClass('min-h-[44px]', 'bg-warning/15', 'border-warning');
    expect(screen.getByTestId('visibility-public')).toHaveClass('border-edge');
  });
});
