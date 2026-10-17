import { Test, TestingModule } from '@nestjs/testing';
import { ChannelResolverService } from './channel-resolver.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';

// ─── Module builder ──────────────────────────────────────────────────────────

async function buildChannelResolverModule() {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChannelResolverService,
      {
        provide: SettingsService,
        useValue: {
          getDiscordBotDefaultChannel: jest.fn(),
          getDiscordBotDefaultVoiceChannel: jest.fn().mockResolvedValue(null),
        },
      },
      {
        provide: ChannelBindingsService,
        useValue: {
          getChannelForGame: jest.fn(),
          getChannelForSeries: jest.fn().mockResolvedValue(null),
          getVoiceChannelForGame: jest.fn().mockResolvedValue(null),
          getVoiceChannelForSeries: jest.fn().mockResolvedValue(null),
        },
      },
      {
        provide: DiscordBotClientService,
        useValue: { getGuildId: jest.fn(), getGuild: jest.fn() },
      },
    ],
  }).compile();

  return {
    service: module.get(ChannelResolverService),
    settingsService: module.get<jest.Mocked<SettingsService>>(SettingsService),
    bindingsService: module.get<jest.Mocked<ChannelBindingsService>>(
      ChannelBindingsService,
    ),
    clientService: module.get<jest.Mocked<DiscordBotClientService>>(
      DiscordBotClientService,
    ),
  };
}

describe('ChannelResolverService', () => {
  let service: ChannelResolverService;
  let settingsService: jest.Mocked<SettingsService>;
  let bindingsService: jest.Mocked<ChannelBindingsService>;
  let clientService: jest.Mocked<DiscordBotClientService>;

  beforeEach(async () => {
    const ctx = await buildChannelResolverModule();
    service = ctx.service;
    settingsService = ctx.settingsService;
    bindingsService = ctx.bindingsService;
    clientService = ctx.clientService;
  });

  describe('resolveChannelForEvent — standard fallback', () => {
    it('should return game-specific binding channel when available', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue('game-channel-456');
      const result = await service.resolveChannelForEvent(101);
      expect(result).toBe('game-channel-456');
      expect(bindingsService.getChannelForGame).toHaveBeenCalledWith(
        'guild-123',
        101,
      );
    });

    it('should fall back to default channel when no game binding exists', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue(null);
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
        'default-channel',
      );
      const result = await service.resolveChannelForEvent(101);
      expect(result).toBe('default-channel');
    });

    it('should return the default channel when no game ID is provided', async () => {
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
        'channel-123',
      );
      const result = await service.resolveChannelForEvent(null);
      expect(result).toBe('channel-123');
    });

    it('should return the default channel when game ID is undefined', async () => {
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
        'channel-123',
      );
      const result = await service.resolveChannelForEvent();
      expect(result).toBe('channel-123');
    });

    it('should return null when no default channel is configured and no binding exists', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue(null);
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(null);
      const result = await service.resolveChannelForEvent(101);
      expect(result).toBeNull();
    });

    it('should skip binding lookup when bot is not in a guild', async () => {
      clientService.getGuildId.mockReturnValue(null);
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
        'default-channel',
      );
      const result = await service.resolveChannelForEvent(101);
      expect(result).toBe('default-channel');
      expect(bindingsService.getChannelForGame).not.toHaveBeenCalled();
    });
  });

  describe('resolveChannelForEvent — notificationChannelOverride (ROK-599)', () => {
    it('returns override immediately when provided', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue('game-channel');
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
        'default-channel',
      );
      const result = await service.resolveChannelForEvent(
        101,
        null,
        'override-channel-999',
      );
      expect(result).toBe('override-channel-999');
    });

    it('does NOT consult game or series bindings when override is set', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue('game-channel');
      bindingsService.getChannelForSeries.mockResolvedValue('series-channel');
      await service.resolveChannelForEvent(101, 'series-uuid', 'override-ch');
      expect(bindingsService.getChannelForGame).not.toHaveBeenCalled();
      expect(bindingsService.getChannelForSeries).not.toHaveBeenCalled();
    });

    it('does NOT consult default settings when override is set', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
        'default-channel',
      );
      await service.resolveChannelForEvent(null, null, 'override-ch');
      expect(
        settingsService.getDiscordBotDefaultChannel,
      ).not.toHaveBeenCalled();
    });

    it('override takes priority over all bindings and default', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue('game-channel');
      bindingsService.getChannelForSeries.mockResolvedValue('series-channel');
      settingsService.getDiscordBotDefaultChannel.mockResolvedValue(
        'default-channel',
      );
      const result = await service.resolveChannelForEvent(
        101,
        'series-uuid',
        'override-channel-777',
      );
      expect(result).toBe('override-channel-777');
    });
  });

  describe('resolveChannelForEvent — override fallthrough', () => {
    it('falls through to normal resolution when override is null', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue('game-channel-456');
      const result = await service.resolveChannelForEvent(101, null, null);
      expect(result).toBe('game-channel-456');
      expect(bindingsService.getChannelForGame).toHaveBeenCalledWith(
        'guild-123',
        101,
      );
    });

    it('falls through to normal resolution when override is undefined', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForGame.mockResolvedValue('game-channel-456');
      const result = await service.resolveChannelForEvent(
        101,
        undefined,
        undefined,
      );
      expect(result).toBe('game-channel-456');
    });

    it('returns override even when no guild ID is available', async () => {
      clientService.getGuildId.mockReturnValue(null);
      const result = await service.resolveChannelForEvent(
        null,
        null,
        'override-standalone',
      );
      expect(result).toBe('override-standalone');
    });

    it('override takes priority over series binding', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getChannelForSeries.mockResolvedValue('series-channel');
      const result = await service.resolveChannelForEvent(
        null,
        'series-uuid',
        'event-override',
      );
      expect(result).toBe('event-override');
      expect(bindingsService.getChannelForSeries).not.toHaveBeenCalled();
    });
  });

  describe('resolveVoiceChannelForScheduledEvent', () => {
    it('returns game-specific voice binding when one is configured (Tier 1)', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getVoiceChannelForGame.mockResolvedValue('game-voice-ch');
      const result = await service.resolveVoiceChannelForScheduledEvent(99);
      expect(result).toBe('game-voice-ch');
      expect(
        settingsService.getDiscordBotDefaultVoiceChannel,
      ).not.toHaveBeenCalled();
    });

    it('falls back to app setting when no game voice binding exists (Tier 2)', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getVoiceChannelForGame.mockResolvedValue(null);
      settingsService.getDiscordBotDefaultVoiceChannel.mockResolvedValue(
        'app-default-voice',
      );
      const result = await service.resolveVoiceChannelForScheduledEvent(99);
      expect(result).toBe('app-default-voice');
    });

    it('returns null when no voice channel is configured at any tier', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getVoiceChannelForGame.mockResolvedValue(null);
      settingsService.getDiscordBotDefaultVoiceChannel.mockResolvedValue(null);
      const result = await service.resolveVoiceChannelForScheduledEvent(99);
      expect(result).toBeNull();
    });

    it('returns null when no guild ID is available', async () => {
      clientService.getGuildId.mockReturnValue(null);
      bindingsService.getVoiceChannelForGame.mockResolvedValue(null);
      settingsService.getDiscordBotDefaultVoiceChannel.mockResolvedValue(null);
      const result = await service.resolveVoiceChannelForScheduledEvent(99);
      expect(result).toBeNull();
    });

    it('prefers game binding over app setting when both exist', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getVoiceChannelForGame.mockResolvedValue('game-voice');
      settingsService.getDiscordBotDefaultVoiceChannel.mockResolvedValue(
        'app-default-voice',
      );
      const result = await service.resolveVoiceChannelForScheduledEvent(99);
      expect(result).toBe('game-voice');
      expect(
        settingsService.getDiscordBotDefaultVoiceChannel,
      ).not.toHaveBeenCalled();
    });

    // ROK-1352: Tier 0 — a live ephemeral channel wins over every binding/default.
    it('returns the ephemeral channel first (Tier 0) above all bindings', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getVoiceChannelForSeries.mockResolvedValue(
        'series-voice',
      );
      bindingsService.getVoiceChannelForGame.mockResolvedValue('game-voice');
      settingsService.getDiscordBotDefaultVoiceChannel.mockResolvedValue(
        'app-default-voice',
      );
      const result = await service.resolveVoiceChannelForScheduledEvent(
        99,
        'rg-1',
        'ephemeral-ch',
      );
      expect(result).toBe('ephemeral-ch');
      expect(bindingsService.getVoiceChannelForSeries).not.toHaveBeenCalled();
      expect(bindingsService.getVoiceChannelForGame).not.toHaveBeenCalled();
      expect(
        settingsService.getDiscordBotDefaultVoiceChannel,
      ).not.toHaveBeenCalled();
    });

    it('falls through to bindings when no ephemeral channel is set', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      bindingsService.getVoiceChannelForGame.mockResolvedValue('game-voice');
      const result = await service.resolveVoiceChannelForScheduledEvent(
        99,
        null,
        null,
      );
      expect(result).toBe('game-voice');
    });
  });

  // -------------------------------------------------------------------------
  // ROK-1389 — resolveVoiceChannelHonoringOverride: the ONE shared voice-aware
  // resolver entry (Part 2). It honors notificationChannelOverride as the voice
  // channel ONLY when the guild cache says the channel is voice-based (mirrors
  // resolveVoiceForEdit's guard, scheduled-event.discord-ops.ts:229-233); a
  // cached TEXT override falls through to tiered resolution, and an override not
  // in the cache is used optimistically.
  //
  // RED until ROK-1389 lands: the method does not exist yet, so every call
  // throws at runtime (fails-by-construction). We cast the service to the
  // expected signature so the file still compiles and the existing suite stays
  // green. Keep the method name + arity exactly as the spec names them.
  // -------------------------------------------------------------------------
  describe('resolveVoiceChannelHonoringOverride (ROK-1389)', () => {
    type OverrideResolver = {
      resolveVoiceChannelHonoringOverride(
        gameId: number | null | undefined,
        recurrenceGroupId: string | null | undefined,
        ephemeralChannelId: string | null | undefined,
        override: string | null | undefined,
      ): Promise<string | null>;
    };

    function fakeGuild(channels: Record<string, boolean>) {
      const cache = new Map(
        Object.entries(channels).map(([id, isVoice]) => [
          id,
          { isVoiceBased: () => isVoice },
        ]),
      );
      return { id: 'guild-123', channels: { cache } };
    }

    function overrideResolver(): OverrideResolver {
      return service;
    }

    it('returns the override when the guild cache says it is voice-based', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      clientService.getGuild.mockReturnValue(
        fakeGuild({ 'ov-voice': true }) as never,
      );
      bindingsService.getVoiceChannelForGame.mockResolvedValue('game-voice');

      const result =
        await overrideResolver().resolveVoiceChannelHonoringOverride(
          1,
          null,
          null,
          'ov-voice',
        );

      expect(result).toBe('ov-voice');
      expect(bindingsService.getVoiceChannelForGame).not.toHaveBeenCalled();
    });

    it('falls through to tiered resolution when the override is a cached TEXT channel', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      clientService.getGuild.mockReturnValue(
        fakeGuild({ 'ov-text': false }) as never,
      );
      bindingsService.getVoiceChannelForGame.mockResolvedValue('game-voice');

      const result =
        await overrideResolver().resolveVoiceChannelHonoringOverride(
          1,
          null,
          null,
          'ov-text',
        );

      expect(result).toBe('game-voice');
      expect(result).not.toBe('ov-text');
    });

    it('uses an uncached override optimistically (not in the guild cache)', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      clientService.getGuild.mockReturnValue(fakeGuild({}) as never);

      const result =
        await overrideResolver().resolveVoiceChannelHonoringOverride(
          1,
          null,
          null,
          'ov-uncached',
        );

      expect(result).toBe('ov-uncached');
    });

    it('honors a STAGE voice-channel override (isVoiceBased covers stage — ROK-716 pin)', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      const cache = new Map([
        ['ov-stage', { type: 13, isVoiceBased: () => true }], // ChannelType.GuildStageVoice
      ]);
      clientService.getGuild.mockReturnValue({
        id: 'guild-123',
        channels: { cache },
      } as never);

      const result =
        await overrideResolver().resolveVoiceChannelHonoringOverride(
          1,
          null,
          null,
          'ov-stage',
        );

      expect(result).toBe('ov-stage');
    });

    it('with no override, resolves through the normal voice tiers', async () => {
      clientService.getGuildId.mockReturnValue('guild-123');
      clientService.getGuild.mockReturnValue(fakeGuild({}) as never);
      bindingsService.getVoiceChannelForGame.mockResolvedValue('game-voice');

      const result =
        await overrideResolver().resolveVoiceChannelHonoringOverride(
          1,
          null,
          null,
          null,
        );

      expect(result).toBe('game-voice');
    });
  });
});
