/**
 * ROK-1494 A3 — a voice joiner of an LFG-born event's ephemeral channel must
 * reach `ad_hoc_participants`.
 *
 * The first two cases drive `handleChannelJoin` / `handleChannelLeave`
 * themselves rather than the helper in isolation, because A3 was a WIRING gap:
 * the dispatch returns on `bindings.length === 0` and an ephemeral channel has
 * no binding, so a helper-only spec would have passed against the broken tree.
 */
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';
import { handleChannelJoin } from '../listeners/voice-state-join-dispatch.handlers';
import { handleChannelLeave } from '../listeners/voice-state-leave.handlers';
import { findLfgNowEventByVoiceChannel } from './lfg-now-voice.helpers';

const CHANNEL = 'voice-channel-1';
const MEMBER = {
  discordUserId: 'discord-1',
  discordUsername: 'alice',
  discordAvatarHash: null,
};

function harness(eventRows: Array<{ id: number }> = [{ id: 900 }]) {
  const db: MockDb = createDrizzleMock();
  db.limit.mockResolvedValue(eventRows);
  const participantService = {
    addParticipant: jest.fn().mockResolvedValue(undefined),
    markLeave: jest.fn().mockResolvedValue(undefined),
  };
  const deps = {
    logger: {
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    },
    voiceAttendanceService: {
      findActiveScheduledEvents: jest.fn().mockResolvedValue([]),
    },
    usersService: { findByDiscordId: jest.fn().mockResolvedValue({ id: 7 }) },
    channelMembers: new Map<string, Set<string>>(),
    userChannelMap: new Map<string, string>(),
    voiceGameTracker: new Map(),
    db,
    adHocParticipantService: participantService,
  };
  return { db, deps, participantService };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const any_ = (v: unknown) => v as any;

describe('A3 — LFG-born ephemeral voice joins reach the ad-hoc roster', () => {
  it('records a joiner on a channel with NO binding', async () => {
    const { deps, participantService } = harness();
    const ctx = {
      deps,
      timers: { pendingRechecks: new Map(), pendingSpawnTimers: new Map() },
      channelMembers: deps.channelMembers,
      userChannelMap: deps.userChannelMap,
      presenceDetector: {},
      logger: deps.logger,
      resolveAllBindings: jest.fn().mockResolvedValue([]),
    };

    await handleChannelJoin(any_(ctx), CHANNEL, MEMBER);

    expect(participantService.addParticipant).toHaveBeenCalledWith(900, {
      discordUserId: 'discord-1',
      discordUsername: 'alice',
      discordAvatarHash: null,
      userId: 7,
    });
  });

  it('closes the roster row when they leave that channel', async () => {
    const { deps, participantService } = harness();

    await handleChannelLeave(
      any_(deps),
      CHANNEL,
      'discord-1',
      { pendingRechecks: new Map(), pendingSpawnTimers: new Map() },
      any_({ handleVoiceLeave: jest.fn() }),
      jest.fn().mockResolvedValue(null),
    );

    expect(participantService.markLeave).toHaveBeenCalledWith(900, 'discord-1');
  });

  it('records nothing when the channel belongs to no LFG-born event', async () => {
    const { deps, participantService } = harness([]);
    const ctx = {
      deps,
      timers: { pendingRechecks: new Map(), pendingSpawnTimers: new Map() },
      channelMembers: deps.channelMembers,
      userChannelMap: deps.userChannelMap,
      presenceDetector: {},
      logger: deps.logger,
      resolveAllBindings: jest.fn().mockResolvedValue([]),
    };

    await handleChannelJoin(any_(ctx), CHANNEL, MEMBER);

    expect(participantService.addParticipant).not.toHaveBeenCalled();
  });

  it('resolves the event id, or null when the read finds nothing', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([{ id: 900 }]);
    await expect(findLfgNowEventByVoiceChannel(any_(db), CHANNEL)).resolves.toBe(
      900,
    );

    db.limit.mockResolvedValue([]);
    await expect(
      findLfgNowEventByVoiceChannel(any_(db), CHANNEL),
    ).resolves.toBeNull();
  });
});
