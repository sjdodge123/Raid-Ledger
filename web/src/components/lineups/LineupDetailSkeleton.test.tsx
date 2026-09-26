/**
 * LineupDetailSkeleton must carry an accessible name: Playwright's
 * error-context aria snapshot drops data-testid, so an unnamed div renders as
 * an anonymous `generic` and a hung lineup query looks like any other loader.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineupDetailSkeleton } from './LineupDetailSkeleton';

describe('LineupDetailSkeleton', () => {
  it('is a named status region that keeps its test id', () => {
    render(<LineupDetailSkeleton />);

    const skeleton = screen.getByRole('status', { name: 'Loading lineup' });
    expect(skeleton).toHaveAttribute('data-testid', 'lineup-detail-skeleton');
  });
});
