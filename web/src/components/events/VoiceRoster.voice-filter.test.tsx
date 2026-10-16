/**
 * ROK-1821 — the Voice Channel Roster shows voice rows only. Game-server rows
 * stay on the event roster (as the linked Raid Ledger user) but never render
 * here, and never count toward the "N active / M total" header.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AdHocParticipantDto } from '@raid-ledger/contract';
import { VoiceRoster } from './VoiceRoster';

function row(overrides: Partial<AdHocParticipantDto> = {}): AdHocParticipantDto {
  return {
    id: 'uuid-1', eventId: 42, userId: 1, discordUserId: 'discord-1',
    discordUsername: 'Player', discordAvatarHash: null,
    joinedAt: '2026-10-16T18:00:00Z', leftAt: null,
    totalDurationSeconds: null, sessionCount: 1, ...overrides,
  };
}

const steamOnly = row({ id: 's1', userId: null, discordUserId: null, discordUsername: 'Ragnar', source: 'steam', inVoice: false, onServer: true });
const linkedSteam = row({ id: 's2', userId: 9, discordUserId: null, discordUsername: 'rok', source: 'steam', inVoice: false, onServer: true });
const discordRow = row({ id: 'd1', discordUsername: 'hiphoptobop', source: 'discord', inVoice: true });
const legacyRow = row({ id: 'l1', discordUsername: 'OldTimer' });

describe('VoiceRoster — voice rows only (ROK-1821)', () => {
  it('hides a steam-only server row', () => {
    render(<VoiceRoster participants={[discordRow, steamOnly]} />);
    expect(screen.queryByText('Ragnar')).not.toBeInTheDocument();
  });

  it('hides a linked steam server row', () => {
    render(<VoiceRoster participants={[discordRow, linkedSteam]} />);
    expect(screen.queryByText('rok')).not.toBeInTheDocument();
  });

  it('shows a discord voice row', () => {
    render(<VoiceRoster participants={[discordRow, steamOnly]} />);
    expect(screen.getByText('hiphoptobop')).toBeInTheDocument();
  });

  it('shows a legacy row that has no source', () => {
    render(<VoiceRoster participants={[legacyRow, linkedSteam]} />);
    expect(screen.getByText('OldTimer')).toBeInTheDocument();
  });

  it('counts only voice rows in the active / total header', () => {
    render(<VoiceRoster participants={[discordRow, legacyRow, steamOnly, linkedSteam]} />);
    expect(screen.getByText('2 active / 2 total')).toBeInTheDocument();
    expect(screen.getByText('In Channel (2)')).toBeInTheDocument();
  });

  it('lists an open discord row that left voice under Left, not In Channel', () => {
    const leftVoice = row({ id: 'd2', discordUsername: 'wanderer', source: 'discord', inVoice: false, onServer: true });
    render(<VoiceRoster participants={[discordRow, leftVoice]} />);
    expect(screen.getByText('1 active / 2 total')).toBeInTheDocument();
    expect(screen.getByText('In Channel (1)')).toBeInTheDocument();
    expect(screen.getByText('Left (1)')).toBeInTheDocument();
  });

  it('shows the empty state when every row is a server row', () => {
    render(<VoiceRoster participants={[steamOnly, linkedSteam]} />);
    expect(screen.getByText('0 active / 0 total')).toBeInTheDocument();
    expect(screen.getByText('No participants yet')).toBeInTheDocument();
  });
});
