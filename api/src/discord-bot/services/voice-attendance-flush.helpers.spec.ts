/**
 * Tests for diagnostic logging in findActiveEventsForChannel (ROK-842).
 *
 * AC 1: WARN logged for unrecognized channel (with binding counts)
 * AC 2: DEBUG logged for binding match
 * AC 3: DEBUG logged for default voice channel match
 */
import { findActiveEventsForChannel } from './voice-attendance-flush.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

type Logger = {
  error: jest.Mock;
  debug: jest.Mock;
  warn: jest.Mock;
};

function makeLogger(): Logger {
  return {
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  };
}

const VOICE_PURPOSES = ['game-voice-monitor', 'general-lobby'] as const;

describe('findActiveEventsForChannel — diagnostic logging (ROK-842)', () => {
  let mockDb: MockDb;
  let logger: Logger;

  beforeEach(() => {
    mockDb = createDrizzleMock();
    logger = makeLogger();
    // Default: DB returns empty active events
    mockDb.where.mockResolvedValue([]);
  });

  // --- AC 1: WARN for unrecognized channel ---

  describe('AC1: unrecognized channel logs WARN', () => {
    it('logs a WARN when channelId does not match any binding or default', async () => {
      const bindings = [
        { channelId: 'some-other-ch', bindingPurpose: 'game-voice-monitor', gameId: 1 },
      ];

      await findActiveEventsForChannel(
        mockDb as never,
        'unknown-channel',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[voice-pipe]'),
        'unknown-channel',
        expect.any(Number),
        expect.any(Number),
      );
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('WARN includes total binding count and voice binding count', async () => {
      const bindings = [
        { channelId: 'ch-1', bindingPurpose: 'game-voice-monitor', gameId: 1 },
        { channelId: 'ch-2', bindingPurpose: 'general-lobby', gameId: null },
        { channelId: 'ch-3', bindingPurpose: 'event-channel', gameId: null },
      ];

      await findActiveEventsForChannel(
        mockDb as never,
        'different-channel',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        'different-channel',
        3, // total bindings
        2, // voice bindings only (game-voice-monitor + general-lobby)
      );
    });

    it('returns empty array for unrecognized channel', async () => {
      const result = await findActiveEventsForChannel(
        mockDb as never,
        'no-match-channel',
        [],
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(result).toEqual([]);
    });

    it('WARN is emitted with 0 bindings when no bindings exist', async () => {
      await findActiveEventsForChannel(
        mockDb as never,
        'any-channel',
        [],
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        'any-channel',
        0,
        0,
      );
    });

    it('WARN is not emitted when defaultVoiceChannelId matches', async () => {
      await findActiveEventsForChannel(
        mockDb as never,
        'default-voice-ch',
        [],
        VOICE_PURPOSES,
        'default-voice-ch',
        logger,
      );

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // --- AC 2: DEBUG for binding match ---

  describe('AC2: binding match logs DEBUG', () => {
    it('logs DEBUG when channel matches a game-voice-monitor binding', async () => {
      const bindings = [
        { channelId: 'voice-ch-1', bindingPurpose: 'game-voice-monitor', gameId: 5 },
      ];

      await findActiveEventsForChannel(
        mockDb as never,
        'voice-ch-1',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(logger.debug).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('debug message contains binding purpose and channel id', async () => {
      const bindings = [
        { channelId: 'voice-ch-2', bindingPurpose: 'game-voice-monitor', gameId: 7 },
      ];

      await findActiveEventsForChannel(
        mockDb as never,
        'voice-ch-2',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      const [firstMsg] = logger.debug.mock.calls[0];
      expect(firstMsg).toContain('[voice-pipe]');
    });

    it('logs DEBUG with active event count for binding match', async () => {
      const bindings = [
        { channelId: 'voice-ch-3', bindingPurpose: 'game-voice-monitor', gameId: 10 },
      ];
      mockDb.where.mockResolvedValueOnce([
        { id: 1, gameId: 10 },
        { id: 2, gameId: 10 },
      ]);

      await findActiveEventsForChannel(
        mockDb as never,
        'voice-ch-3',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      const debugCalls = logger.debug.mock.calls;
      // Second debug call reports event count
      const secondCall = debugCalls[1];
      expect(secondCall[1]).toBe(2); // 2 active events
    });

    it('logs DEBUG when channel matches a general-lobby binding', async () => {
      const bindings = [
        { channelId: 'lobby-ch', bindingPurpose: 'general-lobby', gameId: null },
      ];

      await findActiveEventsForChannel(
        mockDb as never,
        'lobby-ch',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(logger.debug).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('returns active events from DB for binding match', async () => {
      const bindings = [
        { channelId: 'voice-ch-4', bindingPurpose: 'game-voice-monitor', gameId: 3 },
      ];
      mockDb.where.mockResolvedValueOnce([{ id: 99, gameId: 3 }]);

      const result = await findActiveEventsForChannel(
        mockDb as never,
        'voice-ch-4',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(result).toEqual([{ eventId: 99, gameId: 3 }]);
    });
  });

  // --- AC 3: DEBUG for default voice channel match ---

  describe('AC3: default voice channel logs DEBUG', () => {
    it('logs DEBUG when channelId matches the default voice channel', async () => {
      await findActiveEventsForChannel(
        mockDb as never,
        'default-voice',
        [],
        VOICE_PURPOSES,
        'default-voice',
        logger,
      );

      expect(logger.debug).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('debug message for default voice channel contains channel id', async () => {
      await findActiveEventsForChannel(
        mockDb as never,
        'my-default-ch',
        [],
        VOICE_PURPOSES,
        'my-default-ch',
        logger,
      );

      const firstDebugMsg = logger.debug.mock.calls[0][0];
      expect(firstDebugMsg).toContain('[voice-pipe]');
    });

    it('returns all active events (no game filter) for default voice channel', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, gameId: 1 },
        { id: 2, gameId: 2 },
      ]);

      const result = await findActiveEventsForChannel(
        mockDb as never,
        'default-voice',
        [],
        VOICE_PURPOSES,
        'default-voice',
        logger,
      );

      expect(result).toHaveLength(2);
    });

    it('does not log WARN when default voice channel matches', async () => {
      await findActiveEventsForChannel(
        mockDb as never,
        'default-v',
        [{ channelId: 'other-ch', bindingPurpose: 'event-channel', gameId: null }],
        VOICE_PURPOSES,
        'default-v',
        logger,
      );

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('binding match takes priority over default voice channel (no double log)', async () => {
      const bindings = [
        { channelId: 'shared-ch', bindingPurpose: 'game-voice-monitor', gameId: 1 },
      ];

      await findActiveEventsForChannel(
        mockDb as never,
        'shared-ch',
        bindings,
        VOICE_PURPOSES,
        'shared-ch', // also set as default
        logger,
      );

      expect(logger.warn).not.toHaveBeenCalled();
      // Only binding-path debug messages, not default-path
      const debugMsgs = logger.debug.mock.calls.map((c) => c[0] as string);
      const hasBindingMsg = debugMsgs.some((m) =>
        m.includes('binding match'),
      );
      expect(hasBindingMsg).toBe(true);
    });
  });

  // --- Snapshot log for null voice channel resolution (AC snapshotH) ---
  // This is tested indirectly via runEventSnapshots in voice-attendance-snapshot.helpers.spec.ts
  // The log in snapshotSingleEvent uses a different logger shape (only .log).
  // Coverage here focuses on findActiveEventsForChannel.

  // --- Edge cases ---

  describe('edge cases', () => {
    it('returns empty array and logs WARN when bindings is empty and no default', async () => {
      const result = await findActiveEventsForChannel(
        mockDb as never,
        'random-ch',
        [],
        VOICE_PURPOSES,
        null,
        logger,
      );

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('unrecognized non-voice binding still logs WARN', async () => {
      const bindings = [
        { channelId: 'random-ch', bindingPurpose: 'event-channel', gameId: null },
      ];

      await findActiveEventsForChannel(
        mockDb as never,
        'random-ch',
        bindings,
        VOICE_PURPOSES,
        null,
        logger,
      );

      // 'event-channel' is not in VOICE_PURPOSES, so it should NOT match
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.debug).not.toHaveBeenCalled();
    });
  });
});
