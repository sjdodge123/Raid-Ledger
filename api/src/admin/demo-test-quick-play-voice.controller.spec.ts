/**
 * DemoTestQuickPlayVoiceController — the DEMO_MODE-only seeded Quick Play join.
 *
 * Pinned: the endpoint is genuinely gated (it mints an event and posts a live
 * Discord embed), the ROK-959 suppression guard runs first and its clearance
 * rides into `handleVoiceJoin` (as on the listener's immediate spawn), a
 * suppressed bind mints nothing, and a join is only recorded in the bind's own
 * voice channel.
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DemoTestQuickPlayVoiceController } from './demo-test-quick-play-voice.controller';

const CHANNEL = '123456789012345678';
const OTHER_CHANNEL = '876543210987654321';
const BINDING_ID = '6f1c2a5e-3b7d-4c1e-9a2b-0d4e5f6a7b8c';
const CLEARANCE = { tag: 'clearance' };
const settings = { getDemoMode: jest.fn() };
const users = { findById: jest.fn() };
const bindings = { getBindingById: jest.fn() };
const adHoc = {
  ensureNotSuppressed: jest.fn(),
  handleVoiceJoin: jest.fn(),
  getActiveState: jest.fn(),
};

function controller(): DemoTestQuickPlayVoiceController {
  return new DemoTestQuickPlayVoiceController(
    settings as never,
    adHoc as never,
    bindings as never,
    users as never,
  );
}

const body = { userId: 7, bindingId: BINDING_ID, channelId: CHANNEL };
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
  bindings.getBindingById.mockResolvedValue({
    id: BINDING_ID,
    channelId: CHANNEL,
    gameId: 3,
    bindingPurpose: 'game-voice-monitor',
    recurrenceGroupId: 'rg-1',
    config: { minPlayers: 1 },
  });
  adHoc.ensureNotSuppressed.mockResolvedValue(CLEARANCE);
  adHoc.handleVoiceJoin.mockResolvedValue(true);
  adHoc.getActiveState.mockReturnValue({ eventId: 55 });
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('DemoTestQuickPlayVoiceController.voiceJoin', () => {
  it('runs the suppression guard, then joins with its clearance', async () => {
    const result = await controller().voiceJoin(body);

    expect(result).toEqual({ spawned: true, eventId: 55 });
    expect(adHoc.ensureNotSuppressed).toHaveBeenCalledWith(
      BINDING_ID,
      3,
      CHANNEL,
    );
    expect(adHoc.handleVoiceJoin).toHaveBeenCalledWith(
      BINDING_ID,
      {
        discordUserId: 'smoke-invitee-fixture-005',
        discordUsername: 'smoke-invitee-5',
        discordAvatarHash: null,
        userId: 7,
      },
      expect.objectContaining({ gameId: 3, recurrenceGroupId: 'rg-1' }),
      undefined,
      undefined,
      CHANNEL,
      CLEARANCE,
    );
    const guardAt = adHoc.ensureNotSuppressed.mock.invocationCallOrder[0];
    const joinAt = adHoc.handleVoiceJoin.mock.invocationCallOrder[0];
    expect(guardAt).toBeLessThan(joinAt ?? 0);
  });

  it('mints nothing when the bind is suppressed', async () => {
    adHoc.ensureNotSuppressed.mockResolvedValue(null);

    const result = await controller().voiceJoin(body);

    expect(result).toEqual({
      spawned: false,
      eventId: null,
      reason: 'suppressed',
    });
    expect(adHoc.handleVoiceJoin).not.toHaveBeenCalled();
  });

  it('reports no event when the join was not recorded', async () => {
    adHoc.handleVoiceJoin.mockResolvedValue(false);

    await expect(controller().voiceJoin(body)).resolves.toEqual({
      spawned: false,
      eventId: null,
    });
  });

  it('is forbidden outside DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';

    await expect(controller().voiceJoin(body)).rejects.toThrow(
      ForbiddenException,
    );
    expect(adHoc.ensureNotSuppressed).not.toHaveBeenCalled();
  });

  it('is forbidden when the demo-mode setting is off', async () => {
    settings.getDemoMode.mockResolvedValue(false);

    await expect(controller().voiceJoin(body)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s an unknown binding', async () => {
    bindings.getBindingById.mockResolvedValue(null);

    await expect(controller().voiceJoin(body)).rejects.toThrow(
      NotFoundException,
    );
    expect(adHoc.ensureNotSuppressed).not.toHaveBeenCalled();
  });

  it('rejects a binding that is not a game-voice-monitor', async () => {
    bindings.getBindingById.mockResolvedValue({
      id: BINDING_ID,
      gameId: null,
      channelId: CHANNEL,
      bindingPurpose: 'general-lobby',
      recurrenceGroupId: null,
      config: null,
    });

    await expect(controller().voiceJoin(body)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a channel the binding does not monitor', async () => {
    const join = controller().voiceJoin({ ...body, channelId: OTHER_CHANNEL });

    await expect(join).rejects.toThrow(
      `Binding ${BINDING_ID} monitors channel ${CHANNEL}, not ${OTHER_CHANNEL}`,
    );
    expect(adHoc.ensureNotSuppressed).not.toHaveBeenCalled();
    expect(adHoc.handleVoiceJoin).not.toHaveBeenCalled();
  });

  it('rejects a channel id too short to be a snowflake', async () => {
    await expect(
      controller().voiceJoin({ ...body, channelId: '42' }),
    ).rejects.toThrow('channelId: must be a Discord snowflake');
  });

  it('rejects a user who is not Discord-linked', async () => {
    users.findById.mockResolvedValue({
      id: 7,
      discordId: 'local:7',
      username: 'u7',
      avatar: null,
    });

    await expect(controller().voiceJoin(body)).rejects.toThrow(
      BadRequestException,
    );
    expect(adHoc.handleVoiceJoin).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    await expect(
      controller().voiceJoin({ ...body, bindingId: 'not-a-uuid' }),
    ).rejects.toThrow(BadRequestException);
  });
});
