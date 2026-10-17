/**
 * ROK-1821 — the Voice Channel Roster stays voice-only, and the same section
 * lists unlinked game-server players in their own "On the game server" group
 * (no signup shows them). A linked server player appears in neither: the
 * signup roster already shows them as their Raid Ledger user.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AdHocParticipantDto } from '@raid-ledger/contract';
import { createMockEvent } from '../../test/factories';
import type { ViewerEventRosterDto } from '../../lib/api/viewer-event-schemas';
import { EventDetailVoiceSection } from './EventDetailSubComponents';

function row(overrides: Partial<AdHocParticipantDto> = {}): AdHocParticipantDto {
  return {
    id: 'uuid-1', eventId: 42, userId: 1, discordUserId: 'discord-1',
    discordUsername: 'Player', discordAvatarHash: null,
    joinedAt: '2026-10-16T18:00:00Z', leftAt: null,
    totalDurationSeconds: null, sessionCount: 1, ...overrides,
  };
}

const guest = row({ id: 's1', userId: null, discordUserId: null, discordUsername: 'Ragnar', source: 'steam', inVoice: false, onServer: true });
const linked = row({ id: 's2', userId: 9, discordUserId: null, discordUsername: 'rok', source: 'steam', inVoice: false, onServer: true });
const voice = row({ id: 'd1', discordUsername: 'hiphoptobop', source: 'discord', inVoice: true });

/** A signup roster holding the given Raid Ledger user ids (ROK-1822). */
function rosterOf(userIds: number[]): ViewerEventRosterDto {
  const signups = userIds.map((id) => ({
    id, eventId: 42, user: { id, username: `user-${id}`, avatar: null },
    signedUpAt: '2026-10-16T17:00:00Z', characterId: null, character: null,
    confirmationStatus: 'pending' as const, status: 'signed_up' as const,
  }));
  return { eventId: 42, signups, count: signups.length };
}

function renderSection(participants: AdHocParticipantDto[], roster?: ViewerEventRosterDto) {
  return render(
    <MemoryRouter>
      <EventDetailVoiceSection showVoiceRoster={true} voiceRoster={{ participants }}
        isAdHoc={false} event={createMockEvent()} eventStatus={null} roster={roster} />
    </MemoryRouter>,
  );
}

function groupOf(label: RegExp): HTMLElement {
  const heading = screen.getByText(label);
  const group = heading.parentElement;
  if (!group) throw new Error(`no group around ${String(label)}`);
  return group;
}

describe('EventDetailVoiceSection — server guests (ROK-1821)', () => {
  it('lists an unlinked server player under "On the game server", not under voice', () => {
    renderSection([voice, guest]);
    expect(within(groupOf(/On the game server \(1\)/)).getByText('Ragnar')).toBeInTheDocument();
    expect(within(groupOf(/In Channel/)).queryByText('Ragnar')).not.toBeInTheDocument();
  });

  it('shows the section for an unlinked server player even with no voice rows', () => {
    renderSection([guest]);
    expect(screen.getByText('Ragnar')).toBeInTheDocument();
    expect(screen.queryByText('Voice Channel Roster')).not.toBeInTheDocument();
  });

  it('a linked server player appears in neither group', () => {
    renderSection([voice, guest, linked]);
    expect(screen.queryByText('rok')).not.toBeInTheDocument();
    expect(screen.getByText('On the game server (1)')).toBeInTheDocument();
  });

  it('voice rows are unchanged and no server group shows without guests', () => {
    renderSection([voice, linked]);
    expect(within(groupOf(/In Channel \(1\)/)).getByText('hiphoptobop')).toBeInTheDocument();
    expect(screen.getByText('1 active / 1 total')).toBeInTheDocument();
    expect(screen.queryByText(/On the game server/)).not.toBeInTheDocument();
  });

  it('lists a linked server player with no signup (no Discord id) under "On the game server" (ROK-1822)', () => {
    renderSection([voice, guest, linked], rosterOf([1]));
    expect(within(groupOf(/On the game server \(2\)/)).getByText('rok')).toBeInTheDocument();
    expect(within(groupOf(/In Channel/)).queryByText('rok')).not.toBeInTheDocument();
  });

  it('keeps a linked server player who has a signup off the server group (ROK-1822)', () => {
    renderSection([voice, guest, linked], rosterOf([1, 9]));
    expect(screen.queryByText('rok')).not.toBeInTheDocument();
    expect(screen.getByText('On the game server (1)')).toBeInTheDocument();
  });

  it('renders nothing when only linked server rows exist', () => {
    const { container } = renderSection([linked]);
    expect(container).toBeEmptyDOMElement();
  });
});
