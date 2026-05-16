/**
 * Tests for StillWaitingPanel (ROK-1258). Caller-gated, so the panel only
 * needs to verify the rendered output for the list it is handed.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StillWaitingPanel } from './StillWaitingPanel';

const single = [{ id: 1, displayName: 'Alice', steamLinked: true }];

const several = [
  { id: 1, displayName: 'Alice', steamLinked: true },
  { id: 2, displayName: 'Bob', steamLinked: false },
  { id: 3, displayName: 'Charlie', steamLinked: true },
];

describe('StillWaitingPanel (ROK-1258)', () => {
  it('uses singular copy when waiting on one voter', () => {
    render(<StillWaitingPanel voters={single} />);
    expect(screen.getByText('Still waiting on 1 voter')).toBeInTheDocument();
  });

  it('uses plural copy when waiting on multiple voters', () => {
    render(<StillWaitingPanel voters={several} />);
    expect(screen.getByText('Still waiting on 3 voters')).toBeInTheDocument();
  });

  it('renders one chip per outstanding voter', () => {
    render(<StillWaitingPanel voters={several} />);
    const list = screen.getByTestId('still-waiting-voters');
    expect(list).toContainElement(screen.getByText('Alice'));
    expect(list).toContainElement(screen.getByText('Bob'));
    expect(list).toContainElement(screen.getByText('Charlie'));
  });
});
