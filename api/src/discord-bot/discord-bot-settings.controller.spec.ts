/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { DiscordBotService } from './discord-bot.service';
import { DiscordBotClientService } from './discord-bot-client.service';
import { DiscordEmojiService } from './services/discord-emoji.service';
import { SetupWizardService } from './services/setup-wizard.service';
import { SettingsService } from '../settings/settings.service';
import { CharactersService } from '../characters/characters.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

describe('DiscordBotSettingsController', () => {
  let controller: DiscordBotSettingsController;
  let discordBotService: DiscordBotService;
  let discordBotClientService: DiscordBotClientService;
  let settingsService: SettingsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscordBotSettingsController],
      providers: [
        {
          provide: DiscordBotService,
          useValue: {
            getStatus: jest.fn(),
            testToken: jest.fn(),
            ensureConnected: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            getTextChannels: jest.fn(),
            isConnected: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: DiscordEmojiService,
          useValue: {
            syncAllEmojis: jest.fn().mockResolvedValue(undefined),
            isUsingCustomEmojis: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: SetupWizardService,
          useValue: {
            sendSetupWizardToAdmin: jest.fn().mockResolvedValue({ sent: true }),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            setDiscordBotConfig: jest.fn(),
            getDiscordBotConfig: jest.fn(),
            clearDiscordBotConfig: jest.fn(),
            getDiscordBotDefaultChannel: jest.fn(),
            setDiscordBotDefaultChannel: jest.fn(),
          },
        },
        {
          provide: CharactersService,
          useValue: { findAllForUser: jest.fn() },
        },
        {
          provide: DrizzleAsyncProvider,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<DiscordBotSettingsController>(
      DiscordBotSettingsController,
    );
    discordBotService = module.get<DiscordBotService>(DiscordBotService);
    discordBotClientService = module.get<DiscordBotClientService>(
      DiscordBotClientService,
    );
    settingsService = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStatus', () => {
    it('should return bot status', async () => {
      const mockStatus = {
        configured: true,
        connected: true,
        guildName: 'Test Guild',
        memberCount: 100,
      };

      jest.spyOn(discordBotService, 'getStatus').mockResolvedValue(mockStatus);

      const result = await controller.getStatus();

      expect(result).toEqual(mockStatus);
      expect(discordBotService.getStatus).toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('should update config and return success when enabled', async () => {
      const body = {
        botToken: 'new-bot-token',
        enabled: true,
      };

      const result = await controller.updateConfig(body);

      expect(settingsService.setDiscordBotConfig).toHaveBeenCalledWith(
        'new-bot-token',
        true,
      );
      expect(result).toEqual({
        success: true,
        message: 'Configuration saved.',
      });
    });

    it('should update config and return success when disabled', async () => {
      const body = {
        botToken: 'new-bot-token',
        enabled: false,
      };

      const result = await controller.updateConfig(body);

      expect(settingsService.setDiscordBotConfig).toHaveBeenCalledWith(
        'new-bot-token',
        false,
      );
      expect(result).toEqual({
        success: true,
        message: 'Configuration saved.',
      });
    });

    it('should throw validation error when botToken is empty', async () => {
      const body = {
        botToken: '',
        enabled: true,
      };

      await expect(controller.updateConfig(body)).rejects.toThrow(
        BadRequestException,
      );
      expect(settingsService.setDiscordBotConfig).not.toHaveBeenCalled();
    });

    it('should throw validation error when enabled is not boolean', async () => {
      const body = {
        botToken: 'token',
        enabled: 'true' as unknown as boolean,
      };

      await expect(controller.updateConfig(body)).rejects.toThrow(
        BadRequestException,
      );
      expect(settingsService.setDiscordBotConfig).not.toHaveBeenCalled();
    });

    it('should throw validation error when enabled is undefined', async () => {
      const body = {
        botToken: 'token',
        enabled: undefined as unknown as boolean,
      };

      await expect(controller.updateConfig(body)).rejects.toThrow(
        BadRequestException,
      );
      expect(settingsService.setDiscordBotConfig).not.toHaveBeenCalled();
    });

    it('should accept enabled=false as valid', async () => {
      const body = {
        botToken: 'token',
        enabled: false,
      };

      const result = await controller.updateConfig(body);

      expect(result.success).toBe(true);
      expect(settingsService.setDiscordBotConfig).toHaveBeenCalledWith(
        'token',
        false,
      );
    });

    it('should trigger ensureConnected after saving config', async () => {
      const body = {
        botToken: 'new-bot-token',
        enabled: true,
      };

      await controller.updateConfig(body);

      expect(discordBotService.ensureConnected).toHaveBeenCalledWith({
        token: 'new-bot-token',
        enabled: true,
      });
    });

    it('should trigger ensureConnected even when disabled (ensureConnected handles skip)', async () => {
      const body = {
        botToken: 'new-bot-token',
        enabled: false,
      };

      await controller.updateConfig(body);

      expect(discordBotService.ensureConnected).toHaveBeenCalledWith({
        token: 'new-bot-token',
        enabled: false,
      });
    });
  });

  describe('testConnection', () => {
    it('should test provided token', async () => {
      const body = { botToken: 'test-token' };
      const mockResult = {
        success: true,
        guildName: 'Test Guild',
        message: 'Connected to Test Guild (50 members)',
      };

      jest.spyOn(discordBotService, 'testToken').mockResolvedValue(mockResult);

      const result = await controller.testConnection(body);

      expect(discordBotService.testToken).toHaveBeenCalledWith('test-token');
      expect(result).toEqual(mockResult);
    });

    it('should use stored token when no token provided', async () => {
      const body = {};
      const mockConfig = { token: 'stored-token', enabled: true };
      const mockResult = {
        success: true,
        message: 'Connected',
      };

      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(mockConfig);
      jest.spyOn(discordBotService, 'testToken').mockResolvedValue(mockResult);

      const result = await controller.testConnection(body);

      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(discordBotService.testToken).toHaveBeenCalledWith('stored-token');
      expect(result).toEqual(mockResult);
    });

    it('should return error when no token and no config', async () => {
      const body = {};

      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(null);

      const result = await controller.testConnection(body);

      expect(result).toEqual({
        success: false,
        message: 'No bot token configured',
      });
      expect(discordBotService.testToken).not.toHaveBeenCalled();
    });

    it('should throw validation error when body is undefined', async () => {
      await expect(
        controller.testConnection(
          undefined as unknown as Record<string, string>,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prefer provided token over stored config', async () => {
      const body = { botToken: 'provided-token' };
      const mockConfig = { token: 'stored-token', enabled: true };
      const mockResult = {
        success: true,
        message: 'Connected',
      };

      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(mockConfig);
      jest.spyOn(discordBotService, 'testToken').mockResolvedValue(mockResult);

      await controller.testConnection(body);

      expect(discordBotService.testToken).toHaveBeenCalledWith(
        'provided-token',
      );
      expect(settingsService.getDiscordBotConfig).not.toHaveBeenCalled();
    });

    it('should handle empty string token', async () => {
      const body = { botToken: '' };
      const mockConfig = { token: 'stored-token', enabled: true };
      const mockResult = {
        success: true,
        message: 'Connected',
      };

      jest
        .spyOn(settingsService, 'getDiscordBotConfig')
        .mockResolvedValue(mockConfig);
      jest.spyOn(discordBotService, 'testToken').mockResolvedValue(mockResult);

      await controller.testConnection(body);

      // Empty string is falsy, so should fall back to stored config
      expect(settingsService.getDiscordBotConfig).toHaveBeenCalled();
      expect(discordBotService.testToken).toHaveBeenCalledWith('stored-token');
    });
  });

  describe('clearConfig', () => {
    it('should clear config and return success', async () => {
      const result = await controller.clearConfig();

      expect(settingsService.clearDiscordBotConfig).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        message: 'Discord bot configuration cleared.',
      });
    });

    it('should handle errors during clear', async () => {
      jest
        .spyOn(settingsService, 'clearDiscordBotConfig')
        .mockRejectedValue(new Error('Database error'));

      await expect(controller.clearConfig()).rejects.toThrow('Database error');
    });
  });

  describe('getChannels', () => {
    it('should return text channels from the client service', () => {
      const mockChannels = [
        { id: '123', name: 'general' },
        { id: '456', name: 'raids' },
      ];
      jest
        .spyOn(discordBotClientService, 'getTextChannels')
        .mockReturnValue(mockChannels);

      const result = controller.getChannels();

      expect(result).toEqual(mockChannels);
      expect(discordBotClientService.getTextChannels).toHaveBeenCalled();
    });

    it('should return empty array when bot is not connected', () => {
      jest
        .spyOn(discordBotClientService, 'getTextChannels')
        .mockReturnValue([]);

      const result = controller.getChannels();

      expect(result).toEqual([]);
    });
  });

  describe('getDefaultChannel', () => {
    it('should return the default channel ID', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotDefaultChannel')
        .mockResolvedValue('123456');

      const result = await controller.getDefaultChannel();

      expect(result).toEqual({ channelId: '123456' });
    });

    it('should return null when no default channel is set', async () => {
      jest
        .spyOn(settingsService, 'getDiscordBotDefaultChannel')
        .mockResolvedValue(null);

      const result = await controller.getDefaultChannel();

      expect(result).toEqual({ channelId: null });
    });
  });

  describe('setDefaultChannel', () => {
    it('should set the default channel and return success', async () => {
      const result = await controller.setDefaultChannel({
        channelId: '123456',
      });

      expect(settingsService.setDiscordBotDefaultChannel).toHaveBeenCalledWith(
        '123456',
      );
      expect(result).toEqual({
        success: true,
        message: 'Default channel updated.',
      });
    });

    it('should throw BadRequestException when channelId is missing', async () => {
      await expect(controller.setDefaultChannel({})).rejects.toThrow(
        BadRequestException,
      );
      expect(
        settingsService.setDiscordBotDefaultChannel,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when channelId is empty string', async () => {
      await expect(
        controller.setDefaultChannel({ channelId: '' }),
      ).rejects.toThrow(BadRequestException);
      expect(
        settingsService.setDiscordBotDefaultChannel,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when channelId is not a string', async () => {
      await expect(
        controller.setDefaultChannel({ channelId: 123 }),
      ).rejects.toThrow(BadRequestException);
      expect(
        settingsService.setDiscordBotDefaultChannel,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when body is null', async () => {
      await expect(controller.setDefaultChannel(null)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
