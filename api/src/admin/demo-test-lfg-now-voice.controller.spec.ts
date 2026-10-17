/**
 * DemoTestLfgNowVoiceController — the DEMO_MODE-only seeded voice join/leave.
 *
 * Two claims worth pinning: the endpoints are genuinely gated (they write the
 * ad-hoc roster and re-render a live Discord post), and they delegate to the
 * voice listener's OWN recording helpers with the listener's dependency shape
 * — a parallel roster write here would let the smoke pass while the real
 * join path stayed broken.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  recordLfgNowVoiceJoin,
  recordLfgNowVoiceLeave,
} from '../discord-bot/lfg-now/lfg-now-voice.helpers';
import { DemoTestLfgNowVoiceController } from './demo-test-lfg-now-voice.controller';

jest.mock('../discord-bot/lfg-now/lfg-now-voice.helpers', () => ({
  ...jest.requireActual('../discord-bot/lfg-now/lfg-now-voice.helpers'),
  recordLfgNowVoiceJoin: jest.fn(),
  recordLfgNowVoiceLeave: jest.fn(),
}));

const CHANNEL = '123456789012345678';
const settings = { getDemoMode: jest.fn() };
const users = { findById: jest.fn(), findByDiscordId: jest.fn() };
const participants = { addParticipant: jest.fn(), markLeave: jest.fn() };
const db = { tag: 'db' };

function controller(): DemoTestLfgNowVoiceController {
  return new DemoTestLfgNowVoiceController(
    settings as never,
    db as never,
    participants as never,
    users as never,
  );
}

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEMO_MODE = 'true';
  settings.getDemoMode.mockResolvedValue(true);
  users.findById.mockResolvedValue({
    id: 7,
    discordId: 'smoke-invitee-fixture-005',
    username: 'smoke-invitee-5',
    avatar: null,
  });
  jest.mocked(recordLfgNowVoiceJoin).mockResolvedValue(41);
  jest.mocked(recordLfgNowVoiceLeave).mockResolvedValue(41);
});

afterAll(() => {
  process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

/** The deps the listener's `lfgNowDeps` builds from this controller. */
const listenerDeps = expect.objectContaining({
  db,
  participantService: participants,
  usersService: users,
});

describe('DemoTestLfgNowVoiceController.voiceJoin', () => {
  it('records the seeded member through the listener helper', async () => {
    const result = await controller().voiceJoin({
      userId: 7,
      channelId: CHANNEL,
    });

    expect(result).toEqual({ recorded: true, eventId: 41 });
    expect(users.findById).toHaveBeenCalledWith(7);
    expect(recordLfgNowVoiceJoin).toHaveBeenCalledWith(listenerDeps, CHANNEL, {
      discordUserId: 'smoke-invitee-fixture-005',
      discordUsername: 'smoke-invitee-5',
      discordAvatarHash: null,
    });
  });

  it('reports recorded:false when no open LFG-born event owns the channel', async () => {
    jest.mocked(recordLfgNowVoiceJoin).mockResolvedValue(null);

    await expect(
      controller().voiceJoin({ userId: 7, channelId: CHANNEL }),
    ).resolves.toEqual({ recorded: false, eventId: null });
  });

  it('refuses when the process is not in DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';

    await expect(
      controller().voiceJoin({ userId: 7, channelId: CHANNEL }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(recordLfgNowVoiceJoin).not.toHaveBeenCalled();
  });

  it('refuses when the demo-mode setting is off', async () => {
    settings.getDemoMode.mockResolvedValue(false);

    await expect(
      controller().voiceJoin({ userId: 7, channelId: CHANNEL }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(recordLfgNowVoiceJoin).not.toHaveBeenCalled();
  });

  it('rejects a body without a snowflake channelId', async () => {
    await expect(
      controller().voiceJoin({ userId: 7, channelId: 'vc-1' }),
    ).rejects.toThrow(/Validation failed/);
    expect(recordLfgNowVoiceJoin).not.toHaveBeenCalled();
  });

  it('404s an unknown user', async () => {
    users.findById.mockResolvedValue(undefined);

    await expect(
      controller().voiceJoin({ userId: 7, channelId: CHANNEL }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([null, 'local:admin', 'unlinked:999'])(
    'rejects a user whose discordId is %p (not Discord-linked)',
    async (discordId) => {
      users.findById.mockResolvedValue({ id: 7, discordId, username: 'x' });

      await expect(
        controller().voiceJoin({ userId: 7, channelId: CHANNEL }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(recordLfgNowVoiceJoin).not.toHaveBeenCalled();
    },
  );
});

describe('DemoTestLfgNowVoiceController.voiceLeave', () => {
  it('closes the seeded member through the listener helper', async () => {
    const result = await controller().voiceLeave({
      userId: 7,
      channelId: CHANNEL,
    });

    expect(result).toEqual({ recorded: true, eventId: 41 });
    expect(recordLfgNowVoiceLeave).toHaveBeenCalledWith(
      listenerDeps,
      CHANNEL,
      'smoke-invitee-fixture-005',
    );
  });

  it('refuses when the process is not in DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';

    await expect(
      controller().voiceLeave({ userId: 7, channelId: CHANNEL }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(recordLfgNowVoiceLeave).not.toHaveBeenCalled();
  });
});
