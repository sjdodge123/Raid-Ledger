/**
 * VoiceRoster.test.tsx
 *
 * Tests for the VoiceRoster component (ROK-530, renamed from AdHocRoster).
 * Verifies the component renders correctly for both ad-hoc and planned events.
 * Note: AdHocRoster is now a re-export of VoiceRoster for backwards compatibility.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceRoster } from './VoiceRoster';
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
    joinedAt: '2026-03-01T18:00:00Z',
    leftAt: null,
    totalDurationSeconds: null,
    sessionCount: 1,
    ...overrides,
  };
}

describe('VoiceRoster', () => {
  // ── Empty state ─────────────────────────────────────────────────────────────

  it('renders heading', () => {
    render(<VoiceRoster participants={[]} activeCount={0} />);

    expect(screen.getByText('Voice Channel Roster')).toBeInTheDocument();
  });

  it('shows empty state when no participants', () => {
    render(<VoiceRoster participants={[]} activeCount={0} />);

    expect(screen.getByText('No participants yet')).toBeInTheDocument();
  });

  it('does not show "In Channel" or "Left" sections when roster is empty', () => {
    render(<VoiceRoster participants={[]} activeCount={0} />);

    expect(screen.queryByText(/In Channel/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Left/)).not.toBeInTheDocument();
  });

  // ── Active/total count display ─────────────────────────────────────────────

  it('shows active/total count summary', () => {
    const participants = [
      createParticipant({ id: 'p1', discordUsername: 'Player1' }),
      createParticipant({ id: 'p2', discordUsername: 'Player2', leftAt: '2026-03-01T18:30:00Z', totalDurationSeconds: 1800 }),
    ];

    render(<VoiceRoster participants={participants} activeCount={1} />);

    expect(screen.getByText('1 active / 2 total')).toBeInTheDocument();
  });

  it('shows 0 active / 0 total for empty roster', () => {
    render(<VoiceRoster participants={[]} activeCount={0} />);

    expect(screen.getByText('0 active / 0 total')).toBeInTheDocument();
  });

  // ── Active vs left sections ───────────────────────────────────────────────

  it('renders active and left participants in separate sections', () => {
    const active = createParticipant({ id: 'p-active', discordUsername: 'ActivePlayer' });
    const left = createParticipant({
      id: 'p-left',
      discordUsername: 'LeftPlayer',
      leftAt: '2026-03-01T18:30:00Z',
      totalDurationSeconds: 1800,
    });

    render(<VoiceRoster participants={[active, left]} activeCount={1} />);

    expect(screen.getByText('ActivePlayer')).toBeInTheDocument();
    expect(screen.getByText('LeftPlayer')).toBeInTheDocument();
    expect(screen.getByText(/In Channel \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Left \(1\)/)).toBeInTheDocument();
  });

  it('does not show "In Channel" section when all participants have left', () => {
    const left = createParticipant({
      leftAt: '2026-03-01T18:30:00Z',
      totalDurationSeconds: 1800,
    });

    render(<VoiceRoster participants={[left]} activeCount={0} />);

    expect(screen.queryByText(/In Channel/)).not.toBeInTheDocument();
    expect(screen.getByText(/Left \(1\)/)).toBeInTheDocument();
  });

  it('does not show "Left" section when all participants are still active', () => {
    const active = createParticipant({ leftAt: null });

    render(<VoiceRoster participants={[active]} activeCount={1} />);

    expect(screen.getByText(/In Channel \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/^Left/)).not.toBeInTheDocument();
  });

  // ── Avatar display ─────────────────────────────────────────────────────────

  it('renders discord avatar image when discordAvatarHash is present', () => {
    const withAvatar = createParticipant({
      discordAvatarHash: 'abc123',
      discordUserId: 'discord-avatar',
    });

    const { container } = render(
      <VoiceRoster participants={[withAvatar]} activeCount={1} />,
    );

    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img?.src).toContain('cdn.discordapp.com/avatars/discord-avatar/abc123');
  });

  it('renders fallback initial when no avatar hash', () => {
    const noAvatar = createParticipant({
      discordAvatarHash: null,
      discordUsername: 'NoAvatarUser',
    });

    render(<VoiceRoster participants={[noAvatar]} activeCount={1} />);

    expect(screen.getByText('N')).toBeInTheDocument();
  });

  it('uses uppercase first letter of username for fallback avatar', () => {
    const noAvatar = createParticipant({
      discordAvatarHash: null,
      discordUsername: 'zen',
    });

    render(<VoiceRoster participants={[noAvatar]} activeCount={1} />);

    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  // ── Guest label ───────────────────────────────────────────────────────────

  it('shows "(guest)" label for participants with no userId (unlinked)', () => {
    const guest = createParticipant({ userId: null, discordUsername: 'GuestUser' });

    render(<VoiceRoster participants={[guest]} activeCount={1} />);

    expect(screen.getByText('(guest)')).toBeInTheDocument();
  });

  it('does not show "(guest)" for participants with userId', () => {
    const linked = createParticipant({ userId: 99, discordUsername: 'LinkedUser' });

    render(<VoiceRoster participants={[linked]} activeCount={1} />);

    expect(screen.queryByText('(guest)')).not.toBeInTheDocument();
  });

  // ── Join time display ─────────────────────────────────────────────────────

  it('shows join time for participants', () => {
    const p = createParticipant({ joinedAt: '2026-03-01T18:00:00Z' });

    render(<VoiceRoster participants={[p]} activeCount={1} />);

    expect(screen.getByText(/joined/)).toBeInTheDocument();
  });

  // ── Duration formatting ───────────────────────────────────────────────────

  it('shows formatted duration for participants with totalDurationSeconds', () => {
    const withDuration = createParticipant({
      leftAt: '2026-03-01T19:30:00Z',
      totalDurationSeconds: 5400, // 1h 30m
    });

    render(<VoiceRoster participants={[withDuration]} activeCount={0} />);

    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });

  it('formats duration less than 1 minute as "<1m"', () => {
    const p = createParticipant({
      leftAt: '2026-03-01T18:00:30Z',
      totalDurationSeconds: 30,
    });

    render(<VoiceRoster participants={[p]} activeCount={0} />);

    expect(screen.getByText('<1m')).toBeInTheDocument();
  });

  it('formats zero duration as "<1m"', () => {
    const p = createParticipant({
      leftAt: '2026-03-01T18:00:00Z',
      totalDurationSeconds: 0,
    });

    render(<VoiceRoster participants={[p]} activeCount={0} />);

    expect(screen.getByText('<1m')).toBeInTheDocument();
  });

  it('formats duration in whole minutes when under 1 hour', () => {
    const p = createParticipant({
      leftAt: '2026-03-01T18:45:00Z',
      totalDurationSeconds: 2700, // 45m
    });

    render(<VoiceRoster participants={[p]} activeCount={0} />);

    expect(screen.getByText('45m')).toBeInTheDocument();
  });

  it('formats exact hour without minutes', () => {
    const p = createParticipant({
      leftAt: '2026-03-01T19:00:00Z',
      totalDurationSeconds: 3600, // 1h
    });

    render(<VoiceRoster participants={[p]} activeCount={0} />);

    expect(screen.getByText('1h')).toBeInTheDocument();
  });

  it('does not show duration when totalDurationSeconds is null', () => {
    const p = createParticipant({ totalDurationSeconds: null });

    render(<VoiceRoster participants={[p]} activeCount={1} />);

    expect(screen.queryByText(/<1m/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+m$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+h$/)).not.toBeInTheDocument();
  });

  // ── Multiple participants ─────────────────────────────────────────────────

  it('renders all participants', () => {
    const participants = [
      createParticipant({ id: 'p1', discordUsername: 'Alpha' }),
      createParticipant({ id: 'p2', discordUsername: 'Beta' }),
      createParticipant({ id: 'p3', discordUsername: 'Gamma' }),
    ];

    render(<VoiceRoster participants={participants} activeCount={3} />);

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('handles many left participants without errors', () => {
    const participants = Array.from({ length: 10 }, (_, i) =>
      createParticipant({
        id: `p-left-${i}`,
        discordUsername: `Player${i}`,
        leftAt: '2026-03-01T18:30:00Z',
        totalDurationSeconds: 1800,
      }),
    );

    expect(() =>
      render(<VoiceRoster participants={participants} activeCount={0} />),
    ).not.toThrow();

    expect(screen.getByText(/Left \(10\)/)).toBeInTheDocument();
  });
});
