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
});
