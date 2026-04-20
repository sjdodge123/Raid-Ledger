/**
 * Tests for InviteeMultiSelect (ROK-1065).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InviteeMultiSelect } from './InviteeMultiSelect';

describe('InviteeMultiSelect', () => {
  it('renders the current IDs as comma-separated text in the input', () => {
    render(<InviteeMultiSelect value={[12, 18, 31]} onChange={() => {}} />);
    const input = screen.getByTestId('invitee-user-ids') as HTMLInputElement;
    expect(input.value).toBe('12,18,31');
  });

  it('parses comma-separated numbers and drops junk on change', () => {
    const onChange = vi.fn();
    render(<InviteeMultiSelect value={[]} onChange={onChange} />);
    const input = screen.getByTestId('invitee-user-ids') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12, 18, abc, -3, 31' } });
    expect(onChange).toHaveBeenCalledWith([12, 18, 31]);
  });

  it('collapses whitespace and returns empty array when blank', () => {
    const onChange = vi.fn();
    render(<InviteeMultiSelect value={[1]} onChange={onChange} />);
    const input = screen.getByTestId('invitee-user-ids') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
