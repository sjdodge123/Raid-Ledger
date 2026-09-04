/**
 * ROK-1446 D12 — the DEMO_MODE seam that lets the companion bot smoke the
 * channel presence embed.
 *
 * Bots are filtered out of every room (`humanMembers`, AC3) and the companion
 * bot IS a bot, so no real voice join can ever put it on this embed. The seam
 * stands in for the Discord read + detection step ONLY; partition, linked-event
 * lookup, render, post/edit and persistence all still run for real.
 *
 * Three behaviours this spec exists to pin, each verified by mutation:
 *   1. the DEMO_MODE gate rejects before the override is ever touched;
 *   2. `members: null` CLEARS the override;
 *   3. `members: []` is an EMPTY ROOM (the recap path) — a different thing.
 * Plus AC3's structural guarantee: the request body cannot smuggle a `bot`
 * flag onto a snapshot member, because the schema strips unknown keys.
 */
import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { DemoTestLobbyPresenceController } from './demo-test-lobby-presence.controller';
import { ChannelPresenceEmbedService } from './services/channel-presence-embed.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock, MockDb } from '../common/testing/drizzle-mock';

const VOICE_CHANNEL = 'voice-123';

type MockPresence = {
  setRoomOverride: jest.Mock;
  flushNow: jest.Mock;
};

describe('DemoTestLobbyPresenceController (ROK-1446 D12)', () => {
  let controller: DemoTestLobbyPresenceController;
  let presence: MockPresence;
  let settings: { getDemoMode: jest.Mock };
  let db: MockDb;
  let calls: string[];
  const originalDemoMode = process.env.DEMO_MODE;

  beforeEach(async () => {
    process.env.DEMO_MODE = 'true';
    calls = [];
    presence = {
      setRoomOverride: jest.fn(() => {
        calls.push('setRoomOverride');
        return Promise.resolve();
      }),
      flushNow: jest.fn(() => {
        calls.push('flushNow');
        return Promise.resolve();
      }),
    };
    settings = { getDemoMode: jest.fn().mockResolvedValue(true) };
    db = createDrizzleMock();
    db.limit.mockResolvedValue([
      { textChannelId: 'text-456', messageId: 'msg-789' },
    ]);

    const moduleRef = await Test.createTestingModule({
      controllers: [DemoTestLobbyPresenceController],
      providers: [
        { provide: ChannelPresenceEmbedService, useValue: presence },
        { provide: SettingsService, useValue: settings },
        { provide: DrizzleAsyncProvider, useValue: db },
      ],
    }).compile();

    controller = moduleRef.get(DemoTestLobbyPresenceController);
  });

  afterEach(() => {
    if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = originalDemoMode;
  });

  describe('DEMO_MODE gate (copied verbatim from the ephemeral-voice seam)', () => {
    it('rejects when the env flag is off and never touches the override', async () => {
      process.env.DEMO_MODE = 'false';

      await expect(
        controller.setLobbyPresence({
          voiceChannelId: VOICE_CHANNEL,
          members: [],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(presence.setRoomOverride).not.toHaveBeenCalled();
      expect(presence.flushNow).not.toHaveBeenCalled();
    });

    it('rejects when the DB demo-mode setting is off', async () => {
      settings.getDemoMode.mockResolvedValue(false);

      await expect(
        controller.setLobbyPresence({
          voiceChannelId: VOICE_CHANNEL,
          members: [],
        }),
      ).rejects.toThrow('Only available in DEMO_MODE');

      expect(presence.setRoomOverride).not.toHaveBeenCalled();
    });
  });

  describe('override semantics — null clears, [] is an empty room', () => {
    it('passes null straight through to clear the override', async () => {
      await controller.setLobbyPresence({
        voiceChannelId: VOICE_CHANNEL,
        members: null,
      });

      expect(presence.setRoomOverride).toHaveBeenCalledWith(
        VOICE_CHANNEL,
        null,
      );
    });

    it('turns an empty array into a snapshot of an empty room (recap path)', async () => {
      await controller.setLobbyPresence({
        voiceChannelId: VOICE_CHANNEL,
        members: [],
      });

      expect(presence.setRoomOverride).toHaveBeenCalledWith(VOICE_CHANNEL, {
        members: [],
      });
    });

    it('forwards every member field the snapshot type carries', async () => {
      await controller.setLobbyPresence({
        voiceChannelId: VOICE_CHANNEL,
        members: [
          { discordUserId: 'u1', displayName: 'Ana', gameId: 7, eventId: 42 },
          { discordUserId: 'u2', displayName: 'Bo', gameId: null },
        ],
      });

      expect(presence.setRoomOverride).toHaveBeenCalledWith(VOICE_CHANNEL, {
        members: [
          { discordUserId: 'u1', displayName: 'Ana', gameId: 7, eventId: 42 },
          { discordUserId: 'u2', displayName: 'Bo', gameId: null },
        ],
      });
    });

    it('AC3 — cannot smuggle a bot flag onto a snapshot member', async () => {
      await controller.setLobbyPresence({
        voiceChannelId: VOICE_CHANNEL,
        members: [
          {
            discordUserId: 'bot-1',
            displayName: 'Companion',
            gameId: 7,
            bot: true,
            user: { bot: true },
          },
        ],
      });

      const [, snapshot] = presence.setRoomOverride.mock.calls[0] as [
        string,
        { members: Record<string, unknown>[] },
      ];
      expect(Object.keys(snapshot.members[0]).sort()).toEqual([
        'discordUserId',
        'displayName',
        'gameId',
      ]);
    });
  });

  describe('flush + response', () => {
    it('flushes immediately, after the override is set', async () => {
      await controller.setLobbyPresence({
        voiceChannelId: VOICE_CHANNEL,
        members: [],
      });

      expect(calls).toEqual(['setRoomOverride', 'flushNow']);
    });

    it('returns the open rows text channel and message id', async () => {
      const result = await controller.setLobbyPresence({
        voiceChannelId: VOICE_CHANNEL,
        members: [],
      });

      expect(result).toEqual({
        textChannelId: 'text-456',
        messageId: 'msg-789',
      });
    });

    it('returns nulls when no open presence row exists yet', async () => {
      db.limit.mockResolvedValue([]);

      const result = await controller.setLobbyPresence({
        voiceChannelId: VOICE_CHANNEL,
        members: null,
      });

      expect(result).toEqual({ textChannelId: null, messageId: null });
    });
  });

  describe('body validation', () => {
    it('rejects a body with no voiceChannelId', async () => {
      await expect(
        controller.setLobbyPresence({ members: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a member with a missing gameId key', async () => {
      await expect(
        controller.setLobbyPresence({
          voiceChannelId: VOICE_CHANNEL,
          members: [{ discordUserId: 'u1', displayName: 'Ana' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
