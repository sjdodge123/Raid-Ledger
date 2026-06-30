/**
 * SchedulingSlotRow conflict-warning tooltip (ROK-1032).
 *
 * The poll grid already flagged conflicting slots ("⚠ conflicts", ROK-1031);
 * this pins the remaining AC — the warning surfaces the conflicting event
 * NAME (inline + in the hover `title` tooltip).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingSlotRow } from '../SchedulingSlotRow';

function makeSlot(): ScheduleSlotWithVotesDto {
  return {
    id: 1001,
    matchId: 500,
    proposedTime: '2026-07-01T20:00:00.000Z',
    overlapScore: 0,
    suggestedBy: 'user',
    createdAt: '2026-06-01T00:00:00.000Z',
    votes: [],
  } as ScheduleSlotWithVotesDto;
}

function renderRow(conflictEventNames: string[]) {
  return renderWithProviders(
    <SchedulingSlotRow
      slot={makeSlot()}
      voted={false}
      conflictEventNames={conflictEventNames}
      readOnly={false}
      canLock={false}
      onToggleVote={vi.fn()}
      onLock={vi.fn()}
    />,
  );
}

describe('SchedulingSlotRow — conflict warning name (ROK-1032)', () => {
  it('surfaces the conflicting event name inline + in the title tooltip', () => {
    renderRow(['Game Night']);
    const marker = screen.getByTitle('Conflicts with: Game Night');
    expect(marker).toBeInTheDocument();
    expect(marker.textContent).toContain('Game Night');
  });

  it('lists every conflicting event in the tooltip + shows a +N overflow inline', () => {
    renderRow(['Game Night', 'Raid Night']);
    const marker = screen.getByTitle('Conflicts with: Game Night, Raid Night');
    expect(marker.textContent).toContain('Game Night');
    expect(marker.textContent).toContain('+1');
  });

  it('renders no conflict marker when there are no conflicts', () => {
    renderRow([]);
    expect(screen.queryByTitle(/Conflicts with/)).not.toBeInTheDocument();
  });
});
