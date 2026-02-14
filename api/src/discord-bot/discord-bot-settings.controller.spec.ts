/* eslint-disable */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DiscordBotSettingsController } from './discord-bot-settings.controller';
import { DiscordBotService } from './discord-bot.service';
import { SettingsService } from '../settings/settings.service';

describe('DiscordBotSettingsController', () => {
  let controller: DiscordBotSettingsController;
  let discordBotService: DiscordBotService;
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
          },
        },
        {
          provide: SettingsService,
          useValue: {
            setDiscordBotConfig: jest.fn(),
            getDiscordBotConfig: jest.fn(),
            clearDiscordBotConfig: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<DiscordBotSettingsController>(
      DiscordBotSettingsController,
    );
    discordBotService = module.get<DiscordBotService>(DiscordBotService);
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
        message: 'Discord bot configuration saved and bot is starting...',
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
        message: 'Discord bot configuration saved. Bot is disabled.',
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
        enabled: 'true' as any,
      };

      await expect(controller.updateConfig(body)).rejects.toThrow(
        BadRequestException,
      );
      expect(settingsService.setDiscordBotConfig).not.toHaveBeenCalled();
    });

    it('should throw validation error when enabled is undefined', async () => {
      const body = {
        botToken: 'token',
        enabled: undefined as any,
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
      await expect(controller.testConnection(undefined as any)).rejects.toThrow(
        BadRequestException,
      );
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

      const result = await controller.testConnection(body);

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

      const result = await controller.testConnection(body);

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
});
