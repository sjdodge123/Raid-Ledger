/**
 * Tests for LineupParticipantsModal — the read-only roster modal opened from
 * the hero Participants button (ROK-1346). Covers AC2's loading / empty /
 * error / success states and the row testid contract.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LineupParticipantDto } from '@raid-ledger/contract';
import { LineupParticipantsModal } from './LineupParticipantsModal';

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  onRetry: vi.fn(),
  participants: [] as LineupParticipantDto[],
  isLoading: false,
  isError: false,
};

const sample: LineupParticipantDto[] = [
  {
    userId: 1,
    displayName: 'Alice',
    avatar: null,
    customAvatarUrl: null,
    discordId: null,
    role: 'creator',
    status: 'waiting',
    steamLinked: true,
  },
  {
    userId: 2,
    displayName: 'Bob',
    avatar: null,
    customAvatarUrl: null,
    discordId: null,
    role: 'participant',
    status: 'voted',
    steamLinked: false,
  },
];

describe('LineupParticipantsModal (ROK-1346)', () => {
  it('renders nothing when closed', () => {
    render(<LineupParticipantsModal {...baseProps} isOpen={false} />);
    expect(
      screen.queryByTestId('lineup-participants-modal'),
    ).not.toBeInTheDocument();
  });

  it('shows a loading state', () => {
    render(<LineupParticipantsModal {...baseProps} isLoading />);
    expect(screen.getByTestId('participants-loading')).toBeInTheDocument();
  });

  it('shows an empty state when there are no participants', () => {
    render(<LineupParticipantsModal {...baseProps} />);
    expect(screen.getByText(/no participants yet/i)).toBeInTheDocument();
  });

  it('shows an error state with a working retry button', async () => {
    const onRetry = vi.fn();
    render(
      <LineupParticipantsModal {...baseProps} isError onRetry={onRetry} />,
    );
    expect(screen.getByTestId('participants-error')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders one row per participant with role + status chips', () => {
    render(<LineupParticipantsModal {...baseProps} participants={sample} />);
    const rows = screen.getAllByTestId('lineup-participant-row');
    expect(rows).toHaveLength(2);
    // Dialog title yields the accessible name "Participants".
    expect(
      screen.getByRole('dialog', { name: /participants/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Creator')).toBeInTheDocument();
    expect(screen.getByText('Voted')).toBeInTheDocument();
    // Steam badge only on the linked user.
    expect(screen.getAllByText('Steam')).toHaveLength(1);
  });
});
