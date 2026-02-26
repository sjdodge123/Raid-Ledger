import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdHocRoster } from './AdHocRoster';
import type { AdHocParticipantDto } from '@raid-ledger/contract';

function createParticipant(
  overrides: Partial<AdHocParticipantDto> = {},
): AdHocParticipantDto {
  return {
    id: 'uuid-1',
    eventId: 42,
    userId: 1,
    discordUserId: 'discord-123',
    discordUsername: 'TestPlayer',
    discordAvatarHash: null,
    joinedAt: '2026-02-10T18:00:00Z',
    leftAt: null,
    totalDurationSeconds: null,
    sessionCount: 1,
    ...overrides,
  };
}

describe('AdHocRoster', () => {
  it('renders roster heading', () => {
    render(<AdHocRoster participants={[]} activeCount={0} />);

    expect(screen.getByText('Voice Channel Roster')).toBeInTheDocument();
  });

  it('shows empty state when no participants', () => {
    render(<AdHocRoster participants={[]} activeCount={0} />);

    expect(screen.getByText('No participants yet')).toBeInTheDocument();
  });

  it('shows active/total count', () => {
    const participants = [
      createParticipant({ id: 'uuid-1', discordUsername: 'Player1' }),
      createParticipant({
        id: 'uuid-2',
        discordUsername: 'Player2',
        leftAt: '2026-02-10T18:30:00Z',
        totalDurationSeconds: 1800,
      }),
    ];

    render(<AdHocRoster participants={participants} activeCount={1} />);

    expect(screen.getByText('1 active / 2 total')).toBeInTheDocument();
  });

  it('separates active and left participants', () => {
    const active = createParticipant({
      id: 'uuid-active',
      discordUsername: 'ActivePlayer',
    });
    const left = createParticipant({
      id: 'uuid-left',
      discordUsername: 'LeftPlayer',
      leftAt: '2026-02-10T18:30:00Z',
      totalDurationSeconds: 1800,
    });

    render(
      <AdHocRoster participants={[active, left]} activeCount={1} />,
    );

    expect(screen.getByText('ActivePlayer')).toBeInTheDocument();
    expect(screen.getByText('LeftPlayer')).toBeInTheDocument();
    expect(screen.getByText(/In Channel \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Left \(1\)/)).toBeInTheDocument();
  });

  it('renders participant with discord avatar', () => {
    const withAvatar = createParticipant({
      discordAvatarHash: 'abc123',
      discordUserId: 'discord-avatar',
    });

    const { container } = render(
      <AdHocRoster participants={[withAvatar]} activeCount={1} />,
    );

    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.src).toContain('cdn.discordapp.com/avatars/discord-avatar/abc123');
  });

  it('renders fallback initial when no avatar', () => {
    const noAvatar = createParticipant({
      discordAvatarHash: null,
      discordUsername: 'NoAvatarUser',
    });

    render(<AdHocRoster participants={[noAvatar]} activeCount={1} />);

    expect(screen.getByText('N')).toBeInTheDocument();
  });

  it('shows "(guest)" label for unlinked participants', () => {
    const guest = createParticipant({
      userId: null,
      discordUsername: 'GuestUser',
    });

    render(<AdHocRoster participants={[guest]} activeCount={1} />);

    expect(screen.getByText('(guest)')).toBeInTheDocument();
  });

  it('does not show "(guest)" for linked participants', () => {
    const linked = createParticipant({
      userId: 1,
      discordUsername: 'LinkedUser',
    });

    render(<AdHocRoster participants={[linked]} activeCount={1} />);

    expect(screen.queryByText('(guest)')).not.toBeInTheDocument();
  });

  it('shows join time for participants', () => {
    const participant = createParticipant({
      joinedAt: '2026-02-10T18:00:00Z',
    });

    render(<AdHocRoster participants={[participant]} activeCount={1} />);

    // The join time display uses toLocaleTimeString, so it will vary by locale
    // Just check it contains "joined"
    expect(screen.getByText(/joined/)).toBeInTheDocument();
  });

  it('shows duration for participants with totalDurationSeconds', () => {
    const withDuration = createParticipant({
      leftAt: '2026-02-10T19:30:00Z',
      totalDurationSeconds: 5400, // 1h 30m
    });

    render(<AdHocRoster participants={[withDuration]} activeCount={0} />);

    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('formats duration less than 1 minute as "<1m"', () => {
    const shortDuration = createParticipant({
      leftAt: '2026-02-10T18:00:30Z',
      totalDurationSeconds: 30,
    });

    render(<AdHocRoster participants={[shortDuration]} activeCount={0} />);

    expect(screen.getByText('<1m')).toBeInTheDocument();
  });

  it('formats duration in minutes only', () => {
    const minDuration = createParticipant({
      leftAt: '2026-02-10T18:45:00Z',
      totalDurationSeconds: 2700, // 45 min
    });

    render(<AdHocRoster participants={[minDuration]} activeCount={0} />);

    expect(screen.getByText('45m')).toBeInTheDocument();
  });

  it('formats exact hour duration without minutes', () => {
    const exactHour = createParticipant({
      leftAt: '2026-02-10T19:00:00Z',
      totalDurationSeconds: 3600, // 1h
    });

    render(<AdHocRoster participants={[exactHour]} activeCount={0} />);

    expect(screen.getByText('1h')).toBeInTheDocument();
  });

  it('does not show duration when totalDurationSeconds is null', () => {
    const noDuration = createParticipant({
      totalDurationSeconds: null,
    });

    render(<AdHocRoster participants={[noDuration]} activeCount={1} />);

    // Should not show any duration text like "Xm" or "Xh"
    expect(screen.queryByText(/<1m/)).not.toBeInTheDocument();
  });

  it('shows active indicator dot for active participants', () => {
    const active = createParticipant({ leftAt: null });

    const { container } = render(
      <AdHocRoster participants={[active]} activeCount={1} />,
    );

    // The green dot indicator
    const activeDot = container.querySelector('.bg-emerald-500');
    expect(activeDot).toBeInTheDocument();
  });

  it('does not show "In Channel" section when all have left', () => {
    const left = createParticipant({
      leftAt: '2026-02-10T18:30:00Z',
      totalDurationSeconds: 1800,
    });

    render(<AdHocRoster participants={[left]} activeCount={0} />);

    expect(screen.queryByText(/In Channel/)).not.toBeInTheDocument();
    expect(screen.getByText(/Left \(1\)/)).toBeInTheDocument();
  });

  it('does not show "Left" section when all are still active', () => {
    const active = createParticipant({ leftAt: null });

    render(<AdHocRoster participants={[active]} activeCount={1} />);

    expect(screen.queryByText(/Left/)).not.toBeInTheDocument();
    expect(screen.getByText(/In Channel \(1\)/)).toBeInTheDocument();
  });

  it('handles formatDuration with 0 seconds', () => {
    const zeroDuration = createParticipant({
      leftAt: '2026-02-10T18:00:00Z',
      totalDurationSeconds: 0,
    });

    render(<AdHocRoster participants={[zeroDuration]} activeCount={0} />);

    expect(screen.getByText('<1m')).toBeInTheDocument();
  });
});
