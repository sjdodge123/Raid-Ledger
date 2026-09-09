/**
 * Unit specs for the LFG "playing now" trigger (ROK-1494 AC2/AC5/AC9).
 *
 * The spawn transaction itself is mocked — it has its own spec. What is under
 * test here is the SUBSCRIPTION FILTER (which events reach the spawn at all),
 * the Q2 gate bypass, and the promise that no handler ever throws into the
 * emitter, whose call stack is `POST /lfg`.
 */
import { Logger } from '@nestjs/common';
import { LFG_EVENTS } from '../../lfg/lfg.constants';
import { LfgNowSpawnService } from './lfg-now-spawn.service';
import { spawnUnderGroupLock } from './lfg-now-spawn.helpers';
import {
  loadLfgNowEphemeralRow,
  lfgNowEventGameId,
} from './lfg-now.db-helpers';

jest.mock('./lfg-now-spawn.helpers', () => ({
  spawnUnderGroupLock: jest.fn(),
}));
jest.mock('./lfg-now.db-helpers', () => ({
  loadLfgNowEphemeralRow: jest.fn(),
  lfgNowEventGameId: jest.fn(),
}));

const spawn = spawnUnderGroupLock as jest.MockedFunction<
  typeof spawnUnderGroupLock
>;
const loadRow = loadLfgNowEphemeralRow as jest.MockedFunction<
  typeof loadLfgNowEphemeralRow
>;
const eventGameId = lfgNowEventGameId as jest.MockedFunction<
  typeof lfgNowEventGameId
>;

const GAME_ID = 42;
const EVENT_ROW = {
  id: 900,
  title: 'Deep Rock Galactic — Playing now',
  gameId: GAME_ID,
  startTime: '2026-09-06 12:00:00+00',
  endTime: '2026-09-06 13:00:00+00',
  recurrenceGroupId: null,
  ephemeralVoiceEnabled: true,
  ephemeralVoiceChannelId: null,
  privateVoice: false,
};

function build(over: { masterToggle?: boolean } = {}) {
  const emitter = { emit: jest.fn() };
  const ephemeralVoice = {
    createForEvent: jest.fn().mockResolvedValue(undefined),
    shouldCreate: jest.fn().mockResolvedValue(false),
  };
  const settings = {
    getEphemeralVoiceEnabled: jest
      .fn()
      .mockResolvedValue(over.masterToggle ?? false),
  };
  const service = new LfgNowSpawnService(
    {} as any,

    emitter as any,

    ephemeralVoice as any,

    settings as any,
  );
  return { service, emitter, ephemeralVoice, settings };
}

beforeEach(() => {
  jest.clearAllMocks();
  spawn.mockResolvedValue({ eventId: 900, spawned: true });
  loadRow.mockResolvedValue(EVENT_ROW);
  eventGameId.mockResolvedValue(GAME_ID);
});

describe('LfgNowSpawnService — the subscription filter', () => {
  it('ignores a WEEKLY LFM_REACHED', async () => {
    const { service, emitter } = build();
    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'week',
      ttlMinutes: null,
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('spawns on a NOW LFM_REACHED', async () => {
    const { service } = build();
    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'now',
      ttlMinutes: 30,
    });
    expect(spawn).toHaveBeenCalledWith(expect.anything(), GAME_ID);
  });

  it("spawns on GROUP_CHANGED{joined} — AC5's mixed group never re-fires LFM_REACHED", async () => {
    const { service } = build();
    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });
    expect(spawn).toHaveBeenCalledWith(expect.anything(), GAME_ID);
  });

  it('spawns on GROUP_CHANGED{bumped} — a week hand flipped to now', async () => {
    const { service } = build();
    await service.onGroupChanged({ gameId: GAME_ID, reason: 'bumped' });
    expect(spawn).toHaveBeenCalledWith(expect.anything(), GAME_ID);
  });

  it.each(['withdrawn', 'expired', 'converted', 'playing'] as const)(
    'ignores GROUP_CHANGED{%s}',
    async (reason) => {
      const { service } = build();
      await service.onGroupChanged({ gameId: GAME_ID, reason });
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it("emits GROUP_CHANGED{reason:'playing'} after a spawn, never 'converted'", async () => {
    const { service, emitter } = build();
    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });
    expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
      gameId: GAME_ID,
      reason: 'playing',
      eventId: 900,
    });
  });

  it('emits nothing when the spawn decided to do nothing', async () => {
    spawn.mockResolvedValue(null);
    const { service, emitter, ephemeralVoice } = build();
    await service.onLfmReached({
      gameId: GAME_ID,
      activeCount: 2,
      urgency: 'now',
      ttlMinutes: 30,
    });
    expect(emitter.emit).not.toHaveBeenCalled();
    expect(ephemeralVoice.createForEvent).not.toHaveBeenCalled();
  });
});

describe('LfgNowSpawnService — the Q2 ephemeral-voice bypass (AC2)', () => {
  it('creates the channel with the master toggle OFF, never consulting the gate', async () => {
    const { service, ephemeralVoice } = build({ masterToggle: false });
    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });
    expect(ephemeralVoice.createForEvent).toHaveBeenCalledWith(EVENT_ROW);
    expect(ephemeralVoice.shouldCreate).not.toHaveBeenCalled();
  });

  it('logs the bypass at log level, naming the toggle it went around (AC2)', async () => {
    // The gate is deliberately skipped, so the ONLY way an admin can tell why
    // a channel appeared on a toggle-off instance is this line.
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { service } = build({ masterToggle: false });
    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual([
      expect.stringContaining(
        'creating public temp voice for LFG event 900 ' +
          '(ephemeral-voice master toggle = false; gate bypassed by Q2)',
      ),
    ]);
    log.mockRestore();
  });

  it('does NOT re-create the channel on an ATTACH', async () => {
    spawn.mockResolvedValue({ eventId: 900, spawned: false });
    const { service, ephemeralVoice, emitter } = build();
    await service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' });
    expect(ephemeralVoice.createForEvent).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledTimes(1);
  });
});

describe('LfgNowSpawnService — never throws into the emitter', () => {
  it('swallows a spawn failure (POST /lfg must not 500)', async () => {
    spawn.mockRejectedValue(new Error('deadlock detected'));
    const { service, emitter } = build();
    await expect(
      service.onLfmReached({
        gameId: GAME_ID,
        activeCount: 2,
        urgency: 'now',
        ttlMinutes: 30,
      }),
    ).resolves.toBeUndefined();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('swallows a voice-creation failure and STILL announces the session', async () => {
    // The event exists either way; only `ephemeral_voice_channel_id` is missing,
    // which the contract models as a nullable field rather than an absent group.
    const { service, emitter, ephemeralVoice } = build();
    ephemeralVoice.createForEvent.mockRejectedValue(new Error('Discord down'));
    await expect(
      service.onGroupChanged({ gameId: GAME_ID, reason: 'joined' }),
    ).resolves.toBeUndefined();
    expect(emitter.emit).toHaveBeenCalledWith(LFG_EVENTS.GROUP_CHANGED, {
      gameId: GAME_ID,
      reason: 'playing',
      eventId: 900,
    });
  });

  it('re-renders on a participant join and on a participant leave', async () => {
    const { service, emitter } = build();
    await service.onParticipantJoined({
      eventId: 900,
      userId: null,
      discordUserId: 'd-1',
    });
    await service.onParticipantLeft({ eventId: 900, discordUserId: 'd-1' });
    expect(emitter.emit).toHaveBeenCalledTimes(2);
    expect(emitter.emit).toHaveBeenLastCalledWith(LFG_EVENTS.GROUP_CHANGED, {
      gameId: GAME_ID,
      reason: 'playing',
      eventId: 900,
    });
  });

  it('stays silent for a Quick Play event, which is not LFG-born', async () => {
    eventGameId.mockResolvedValue(null);
    const { service, emitter } = build();
    await service.onParticipantJoined({
      eventId: 77,
      userId: 5,
      discordUserId: 'd-5',
    });
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
