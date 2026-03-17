/**
 * Tests for diagnostic logging in trackScheduledEventJoin (ROK-842).
 * AC 3: trackScheduledEventJoin logs channelId + active event count.
 */
import { trackScheduledEventJoin } from './voice-state.handlers';
import type { VoiceHandlerDeps } from './voice-state.handlers';

/** Minimal VoiceHandlerDeps stub for trackScheduledEventJoin tests. */
function makeDeps(
  activeEvents: Array<{ eventId: number; gameId: number | null }>,
): {
  deps: VoiceHandlerDeps;
  mockLogger: {
    debug: jest.Mock;
    error: jest.Mock;
    warn: jest.Mock;
    log: jest.Mock;
  };
  mockFindActive: jest.Mock;
  mockHandleJoin: jest.Mock;
  mockFindByDiscordId: jest.Mock;
} {
  const mockFindActive = jest.fn().mockResolvedValue(activeEvents);
  const mockHandleJoin = jest.fn();
  const mockFindByDiscordId = jest.fn().mockResolvedValue(null);
  const mockLogger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
  };

  const deps = {
    logger: mockLogger as unknown as VoiceHandlerDeps['logger'],
    voiceAttendanceService: {
      findActiveScheduledEvents: mockFindActive,
      handleJoin: mockHandleJoin,
    } as unknown as VoiceHandlerDeps['voiceAttendanceService'],
    usersService: {
      findByDiscordId: mockFindByDiscordId,
    } as unknown as VoiceHandlerDeps['usersService'],
    // Stub the rest — not used by trackScheduledEventJoin
    clientService: {} as VoiceHandlerDeps['clientService'],
    adHocEventService: {} as VoiceHandlerDeps['adHocEventService'],
    departureGraceService: {} as VoiceHandlerDeps['departureGraceService'],
    presenceDetector: {} as VoiceHandlerDeps['presenceDetector'],
    gameActivityService: {} as VoiceHandlerDeps['gameActivityService'],
    adHocEventsGateway: {} as VoiceHandlerDeps['adHocEventsGateway'],
    voiceGameTracker: new Map(),
    userChannelMap: new Map(),
    channelMembers: new Map(),
  } satisfies VoiceHandlerDeps;

  return {
    deps,
    mockLogger,
    mockFindActive,
    mockHandleJoin,
    mockFindByDiscordId,
  };
}

const dm = {
  discordUserId: 'user-abc',
  discordUsername: 'TestUser',
  discordAvatarHash: null,
};

describe('trackScheduledEventJoin — diagnostic logging (ROK-842)', () => {
  it('logs DEBUG with channelId and active event count (AC3)', async () => {
    const { deps, mockLogger } = makeDeps([
      { eventId: 1, gameId: null },
      { eventId: 2, gameId: 5 },
    ]);

    await trackScheduledEventJoin(deps, 'voice-ch-123', dm);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('[voice-pipe]'),
      'voice-ch-123',
      2,
    );
  });

  it('logs DEBUG with count=0 when no active events found', async () => {
    const { deps, mockLogger } = makeDeps([]);

    await trackScheduledEventJoin(deps, 'voice-ch-empty', dm);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('[voice-pipe]'),
      'voice-ch-empty',
      0,
    );
  });

  it('includes correct channelId in the debug log', async () => {
    const { deps, mockLogger } = makeDeps([{ eventId: 10, gameId: 3 }]);

    await trackScheduledEventJoin(deps, 'specific-channel-id', dm);

    const [, loggedChannelId] = mockLogger.debug.mock.calls[0];
    expect(loggedChannelId).toBe('specific-channel-id');
  });

  it('includes the correct active event count in the debug log', async () => {
    const events = [
      { eventId: 1, gameId: null },
      { eventId: 2, gameId: null },
      { eventId: 3, gameId: null },
    ];
    const { deps, mockLogger } = makeDeps(events);

    await trackScheduledEventJoin(deps, 'multi-event-ch', dm);

    const [, , loggedCount] = mockLogger.debug.mock.calls[0];
    expect(loggedCount).toBe(3);
  });

  it('still calls handleJoin for each active event after logging', async () => {
    const { deps, mockHandleJoin, mockFindByDiscordId } = makeDeps([
      { eventId: 5, gameId: null },
      { eventId: 6, gameId: 1 },
    ]);
    mockFindByDiscordId.mockResolvedValue({ id: 99 });

    await trackScheduledEventJoin(deps, 'ch-with-events', dm);

    expect(mockHandleJoin).toHaveBeenCalledTimes(2);
    expect(mockHandleJoin).toHaveBeenCalledWith(
      5,
      dm.discordUserId,
      dm.discordUsername,
      99,
      dm.discordAvatarHash,
    );
    expect(mockHandleJoin).toHaveBeenCalledWith(
      6,
      dm.discordUserId,
      dm.discordUsername,
      99,
      dm.discordAvatarHash,
    );
  });

  it('does not call handleJoin when there are no active events', async () => {
    const { deps, mockHandleJoin } = makeDeps([]);

    await trackScheduledEventJoin(deps, 'empty-ch', dm);

    expect(mockHandleJoin).not.toHaveBeenCalled();
  });
});
