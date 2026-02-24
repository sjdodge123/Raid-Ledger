/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChannelBindingsController } from './channel-bindings.controller';
import { ChannelBindingsService } from './services/channel-bindings.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import type { BindingRecord } from './services/channel-bindings.service';

const makeBinding = (overrides: Partial<BindingRecord> = {}): BindingRecord =>
  ({
    id: 'binding-uuid-1',
    guildId: 'guild-123',
    channelId: 'channel-456',
    channelType: 'text',
    bindingPurpose: 'game-announcements',
    gameId: null,
    recurrenceGroupId: null,
    config: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  }) as BindingRecord;

describe('ChannelBindingsController', () => {
  let controller: ChannelBindingsController;
  let bindingsService: jest.Mocked<ChannelBindingsService>;
  let clientService: jest.Mocked<DiscordBotClientService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChannelBindingsController],
      providers: [
        {
          provide: ChannelBindingsService,
          useValue: {
            getBindings: jest.fn().mockResolvedValue([]),
            getBindingById: jest.fn().mockResolvedValue(null),
            bind: jest.fn(),
            unbind: jest.fn().mockResolvedValue(true),
            updateConfig: jest.fn(),
          },
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            getTextChannels: jest.fn().mockReturnValue([]),
            getVoiceChannels: jest.fn().mockReturnValue([]),
          },
        },
      ],
    }).compile();

    controller = module.get(ChannelBindingsController);
    bindingsService = module.get(ChannelBindingsService);
    clientService = module.get(DiscordBotClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /admin/discord/bindings ───────────────────────────────

  describe('listBindings', () => {
    it('should return empty data array when bot is not in a guild', async () => {
      clientService.getGuildId.mockReturnValue(null);

      const result = await controller.listBindings();

      expect(result).toEqual({ data: [] });
      expect(bindingsService.getBindings).not.toHaveBeenCalled();
    });

    it('should return empty data array when no bindings configured', async () => {
      bindingsService.getBindings.mockResolvedValue([]);

      const result = await controller.listBindings();

      expect(result).toEqual({ data: [] });
    });

    it('should return bindings with enriched channel names from Discord', async () => {
      bindingsService.getBindings.mockResolvedValue([makeBinding()]);
      clientService.getTextChannels.mockReturnValue([
        { id: 'channel-456', name: 'general' },
      ]);

      const result = await controller.listBindings();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].channelName).toBe('general');
    });

    it('should return undefined channelName when channel not found in Discord cache', async () => {
      bindingsService.getBindings.mockResolvedValue([makeBinding()]);
      clientService.getTextChannels.mockReturnValue([]);
      clientService.getVoiceChannels.mockReturnValue([]);

      const result = await controller.listBindings();

      expect(result.data[0].channelName).toBeUndefined();
    });

    it('should map binding fields to ChannelBindingDto shape', async () => {
      const binding = makeBinding({
        id: 'binding-uuid-1',
        guildId: 'guild-123',
        channelId: 'channel-456',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId: 42,
        config: { minPlayers: 5 },
      });
      bindingsService.getBindings.mockResolvedValue([binding]);

      const result = await controller.listBindings();

      expect(result.data[0]).toMatchObject({
        id: 'binding-uuid-1',
        guildId: 'guild-123',
        channelId: 'channel-456',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId: 42,
        config: { minPlayers: 5 },
      });
      expect(typeof result.data[0].createdAt).toBe('string');
      expect(typeof result.data[0].updatedAt).toBe('string');
    });

    it('should enrich voice channel names from voice channel list', async () => {
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ channelId: 'voice-ch-1', channelType: 'voice' }),
      ]);
      clientService.getTextChannels.mockReturnValue([]);
      clientService.getVoiceChannels.mockReturnValue([
        { id: 'voice-ch-1', name: 'raid-voice' },
      ]);

      const result = await controller.listBindings();

      expect(result.data[0].channelName).toBe('raid-voice');
    });

    it('should return multiple bindings', async () => {
      bindingsService.getBindings.mockResolvedValue([
        makeBinding({ id: 'b-1', channelId: 'ch-1' }),
        makeBinding({ id: 'b-2', channelId: 'ch-2' }),
      ]);

      const result = await controller.listBindings();

      expect(result.data).toHaveLength(2);
    });
  });

  // ── POST /admin/discord/bindings ──────────────────────────────

  describe('createBinding', () => {
    it('should throw BadRequestException when bot is not in a guild', async () => {
      clientService.getGuildId.mockReturnValue(null);

      await expect(
        controller.createBinding({
          channelId: 'ch-1',
          channelType: 'text',
          bindingPurpose: 'game-announcements',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when body fails schema validation', async () => {
      await expect(
        controller.createBinding({
          channelType: 'text',
          // missing channelId
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when channelId is empty string', async () => {
      await expect(
        controller.createBinding({
          channelId: '',
          channelType: 'text',
          bindingPurpose: 'game-announcements',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid channelType', async () => {
      await expect(
        controller.createBinding({
          channelId: 'ch-1',
          channelType: 'invalid-type',
          bindingPurpose: 'game-announcements',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid bindingPurpose', async () => {
      await expect(
        controller.createBinding({
          channelId: 'ch-1',
          channelType: 'text',
          bindingPurpose: 'unknown-purpose',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create a binding and return it in DTO shape', async () => {
      const created = makeBinding({
        channelId: 'ch-1',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId: null,
        config: {},
      });
      bindingsService.bind.mockResolvedValue({
        binding: created,
        replacedChannelIds: [],
      });

      const result = await controller.createBinding({
        channelId: 'ch-1',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
      });

      expect(result.data).toMatchObject({
        channelId: 'ch-1',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
      });
      expect(typeof result.data.createdAt).toBe('string');
    });

    it('should call bind with correct arguments including gameId', async () => {
      const gameId = 42;
      const created = makeBinding({ gameId });
      bindingsService.bind.mockResolvedValue({
        binding: created,
        replacedChannelIds: [],
      });

      await controller.createBinding({
        channelId: 'ch-1',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
        gameId,
      });

      expect(bindingsService.bind).toHaveBeenCalledWith(
        'guild-123',
        'ch-1',
        'text',
        'game-announcements',
        gameId,
        undefined,
      );
    });

    it('should pass null gameId when not provided', async () => {
      const created = makeBinding();
      bindingsService.bind.mockResolvedValue({
        binding: created,
        replacedChannelIds: [],
      });

      await controller.createBinding({
        channelId: 'ch-1',
        channelType: 'text',
        bindingPurpose: 'game-announcements',
      });

      expect(bindingsService.bind).toHaveBeenCalledWith(
        expect.any(String),
        'ch-1',
        'text',
        'game-announcements',
        null,
        undefined,
      );
    });
  });

  // ── PATCH /admin/discord/bindings/:id ─────────────────────────

  describe('updateBinding', () => {
    it('should throw NotFoundException when binding does not exist', async () => {
      bindingsService.updateConfig.mockResolvedValue(null);

      await expect(
        controller.updateBinding('nonexistent-id', {
          config: { minPlayers: 3 },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException for invalid body schema', async () => {
      await expect(
        controller.updateBinding('binding-uuid-1', {
          config: { minPlayers: 'not-a-number' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update binding config and return it', async () => {
      const updated = makeBinding({
        config: { minPlayers: 5, gracePeriod: 60 },
      });
      bindingsService.updateConfig.mockResolvedValue(updated);

      const result = await controller.updateBinding('binding-uuid-1', {
        config: { minPlayers: 5, gracePeriod: 60 },
      });

      expect(result.data.config).toEqual({ minPlayers: 5, gracePeriod: 60 });
    });

    it('should update bindingPurpose when provided', async () => {
      const updated = makeBinding({ bindingPurpose: 'game-voice-monitor' });
      bindingsService.updateConfig.mockResolvedValue(updated);

      const result = await controller.updateBinding('binding-uuid-1', {
        bindingPurpose: 'game-voice-monitor',
      });

      expect(result.data.bindingPurpose).toBe('game-voice-monitor');
      expect(bindingsService.updateConfig).toHaveBeenCalledWith(
        'binding-uuid-1',
        {},
        'game-voice-monitor',
      );
    });

    it('should pass empty config when config is not provided', async () => {
      const updated = makeBinding();
      bindingsService.updateConfig.mockResolvedValue(updated);

      await controller.updateBinding('binding-uuid-1', {});

      expect(bindingsService.updateConfig).toHaveBeenCalledWith(
        'binding-uuid-1',
        {},
        undefined,
      );
    });

    it('should throw BadRequestException for negative minPlayers', async () => {
      await expect(
        controller.updateBinding('binding-uuid-1', {
          config: { minPlayers: 0 },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for negative gracePeriod', async () => {
      await expect(
        controller.updateBinding('binding-uuid-1', {
          config: { gracePeriod: -1 },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── DELETE /admin/discord/bindings/:id ────────────────────────

  describe('deleteBinding', () => {
    it('should throw NotFoundException when binding does not exist', async () => {
      bindingsService.getBindingById.mockResolvedValue(null);

      await expect(controller.deleteBinding('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should delete the binding by resolving guildId and channelId', async () => {
      const binding = makeBinding({
        guildId: 'guild-123',
        channelId: 'channel-456',
      });
      bindingsService.getBindingById.mockResolvedValue(binding);

      await controller.deleteBinding('binding-uuid-1');

      expect(bindingsService.unbind).toHaveBeenCalledWith(
        'guild-123',
        'channel-456',
        null,
      );
    });

    it('should return void (204 No Content) on success', async () => {
      bindingsService.getBindingById.mockResolvedValue(makeBinding());

      const result = await controller.deleteBinding('binding-uuid-1');

      expect(result).toBeUndefined();
    });

    it('should look up binding by the provided ID', async () => {
      bindingsService.getBindingById.mockResolvedValue(null);

      await expect(controller.deleteBinding('my-id-xyz')).rejects.toThrow(
        NotFoundException,
      );
      expect(bindingsService.getBindingById).toHaveBeenCalledWith('my-id-xyz');
    });
  });
});
